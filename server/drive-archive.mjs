import {createHmac,createHash,randomUUID} from 'node:crypto';
export const PHOTO_PREFIX='/api/health-intake/tracker/photos/';
const MEALS=['breakfast','lunch','snack','dinner'];
export function createDriveBridge({url,secret,fetchImpl=fetch}){
 if(url && (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)||!secret||secret.length<32))throw Error('Invalid Drive archive configuration');
 async function call(action,payload){
  if(!url)throw Object.assign(Error('相片儲存服務正在設定，請保留頁面，稍後重試。'),{status:503});
  const message=JSON.stringify({action,payload,time:Date.now(),nonce:randomUUID()});
  const signature=createHmac('sha256',secret).update(message).digest('hex');
  let response;try{response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,signature}),redirect:'follow',signal:AbortSignal.timeout(110000)});}catch{throw Object.assign(Error('Google Drive尚未確認儲存，請保留原圖並重試。'),{status:503});}
  let result;try{result=await response.json();}catch{throw Object.assign(Error('Google Drive驗證未完成，原圖保持原狀。'),{status:503});}
  if(!response.ok||result.ok!==true)throw Object.assign(Error('Google Drive驗證未完成，原圖保持原狀。'),{status:503});
  return result;
 }
 return {configured:!!url,check:()=>call('check',{}),upload:payload=>call('upload',payload),verify:payload=>call('verify',payload),download:payload=>call('download',payload)};
}
export function createPhotoArchive({pool,bridge}){
 async function authorizedRef(photo,context){
  if(!photo.startsWith(PHOTO_PREFIX))throw Object.assign(Error('相片索引不正確'),{status:400});
  const id=photo.slice(PHOTO_PREFIX.length);
  let row=(await pool.query('SELECT * FROM hd_photo WHERE id=$1 AND user_id=$2 AND day=$3 AND meal=$4 AND kind=$5',[id,context.userId,context.day,context.meal,context.kind])).rows[0];
  if(!row&&context.kind==='preview'&&context.sourceUserId)row=(await pool.query('SELECT * FROM hd_photo WHERE id=$1 AND user_id=$2 AND day=$3 AND meal=$4 AND kind=$5',[id,context.sourceUserId,context.day,context.meal,'actual'])).rows[0];
  if(!row)throw Object.assign(Error('相片不屬於這份紀錄'),{status:403});
  return row;
 }
 async function archive(content,{userId,day,kind,sourceUserId}){
  const result=structuredClone(content),pending=[],reused=[];
  for(const meal of MEALS)for(let index=0;index<result.meals[meal].photos.length;index++){
   const photo=result.meals[meal].photos[index],context={userId,day,meal,kind,sourceUserId};
   if(photo.startsWith(PHOTO_PREFIX)){await authorizedRef(photo,context);continue;}
   const bytes=Buffer.from(photo.slice(23),'base64'),sha256=createHash('sha256').update(bytes).digest('hex');
   const old=(await pool.query('SELECT * FROM hd_photo WHERE user_id=$1 AND day=$2 AND meal=$3 AND kind=$4 AND sha256=$5',[userId,day,meal,kind,sha256])).rows[0];
   if(old){reused.push(old);result.meals[meal].photos[index]=PHOTO_PREFIX+old.id;continue;}
   pending.push({index,meal,sha256,size:bytes.length,base64:bytes.toString('base64')});
  }
  if(reused.length){const checked=await bridge.verify({files:reused.map(r=>({fileId:r.drive_file_id,folderId:r.drive_folder_id}))});if(!Array.isArray(checked.files)||checked.files.length!==reused.length||checked.files.some((f,i)=>f.verified!==true||f.private!==true||f.fileId!==reused[i].drive_file_id||f.sha256!==reused[i].sha256||f.size!==reused[i].byte_size))throw Error('Existing Drive copy verification failed');}
  if(!pending.length)return result;
  // No image bytes are written to PostgreSQL. Drive readback and privacy checks
  // must all succeed before the caller replaces the encrypted daily record.
  const uploaded=await bridge.upload({clientKey:userId,clientName:'WingTung Lai',day,kind,photos:pending});
  if(!Array.isArray(uploaded.files)||uploaded.files.length!==pending.length)throw Error('Drive verification did not return every file');
  for(let i=0;i<pending.length;i++){
   const expected=pending[i],file=uploaded.files[i];
   if(file.verified!==true||file.private!==true||file.sha256!==expected.sha256||file.size!==expected.size||!/^[-\w]+$/.test(file.fileId||'')||!/^[-\w]+$/.test(file.folderId||''))throw Error('Drive content or privacy verification failed');
  }
  for(let i=0;i<pending.length;i++){
   const photo=pending[i],file=uploaded.files[i],id=randomUUID();
   const stored=(await pool.query('INSERT INTO hd_photo(id,user_id,day,meal,kind,sha256,drive_file_id,drive_folder_id,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,day,meal,kind,sha256) DO UPDATE SET drive_file_id=EXCLUDED.drive_file_id,drive_folder_id=EXCLUDED.drive_folder_id,verified_at=CURRENT_TIMESTAMP RETURNING id',[id,userId,day,photo.meal,kind,photo.sha256,file.fileId,file.folderId,file.size])).rows[0];
   result.meals[photo.meal].photos[photo.index]=PHOTO_PREFIX+stored.id;
  }
  return result;
 }
 async function download(id,{userId,actorId}){
  const row=(await pool.query('SELECT * FROM hd_photo WHERE id=$1',[id])).rows[0];
  if(!row || (row.kind==='actual'?row.user_id!==userId:row.user_id!==actorId))throw Object.assign(Error('找不到可存取的相片'),{status:404});
  const file=await bridge.download({fileId:row.drive_file_id,folderId:row.drive_folder_id});
  const bytes=Buffer.from(file.base64||'','base64');
  if(bytes.length!==row.byte_size||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Object.assign(Error('相片完整性驗證未完成，請稍後重試'),{status:503});
  return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length),'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'",'x-robots-tag':'noindex, nofollow,noarchive'}});
 }
 return {archive,download,configured:bridge.configured};
}
