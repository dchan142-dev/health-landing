import { PHOTO_PREFIX } from "./drive-archive.mjs";
import { readFile } from "node:fs/promises";
const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'];
const PRODUCTS = ['enzyme', 'gut', 'probiotic', 'q10', 'astaxanthin'];
export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= '2026-11-23' && day <= '2026-12-22' && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
}
export function validateDaily(value, {maxPhotos=8}={}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.original !== undefined) {
    const m=value.original;
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k=>!['enzymeMl','intakePct','reminder','stoolCountLabel'].includes(k))) return false;
    if (m.enzymeMl!==null && ![0,10,20,30].includes(m.enzymeMl)) return false;
    if (m.intakePct!==null && (!Number.isInteger(m.intakePct)||m.intakePct<0||m.intakePct>100)) return false;
    if(m.stoolCountLabel!==undefined && !['','0次','1次','2次','3次或以上'].includes(m.stoolCountLabel))return false;
    const r=m.reminder;
    if (!r || typeof r!=='object' || Array.isArray(r) || JSON.stringify(r).length>2048 || Object.keys(r).some(k=>!['morning','evening','phoneEnabled','phone','emailEnabled','email','tasksEnabled','onboarded'].includes(k))) return false;
    for(const [k,v] of Object.entries(r)) { if(['phoneEnabled','emailEnabled','tasksEnabled','onboarded'].includes(k)){if(typeof v!=='boolean')return false;}else if(typeof v!=='string'||v.length>254||/[<>]/.test(v))return false; }
    for(const k of ['morning','evening'])if(r[k]!==undefined&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(r[k]))return false;
  }
  const keys = ['weight','sbp','dbp','sleep','activity','stress','stoolCount','stoolType','comfort','notes','meals','products','intake'];
  if (Object.keys(value).some(k => k!=='original' && !keys.includes(k))) return false;
  for (const k of keys.filter(k => !['meals','products'].includes(k))) {
    if (typeof value[k] !== 'string' || value[k].length > (k === 'notes' ? 2000 : 100) || /[<>]/.test(value[k])) return false;
  }
  for (const [k,min,max] of [['weight',20,150],['sbp',50,250],['dbp',25,160],['sleep',0,24],['activity',0,600],['stoolCount',0,30]]) {
    if (value[k] !== '' && (!/^\d+(\.\d+)?$/.test(value[k]) || Number(value[k]) < min || Number(value[k]) > max)) return false;
  }
  if (!value.meals || Object.keys(value.meals).length !== 4 || !value.products || Object.keys(value.products).length !== 5) return false;
  for (const k of MEALS) {
    const meal = value.meals[k];
    if (!meal || Object.keys(meal).some(k=>!['note','photos'].includes(k)) || typeof meal.note !== 'string' || meal.note.length > 1000 || /[<>]/.test(meal.note) || !Array.isArray(meal.photos) || meal.photos.length > maxPhotos) return false;
    for (const photo of meal.photos) {
      if (typeof photo === 'string' && /^\/api\/health-intake\/tracker\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(photo))continue;
      if (typeof photo !== 'string' || photo.length > 100000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo)) return false;
      const bytes = Buffer.from(photo.slice(23),'base64');
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
    }
  }
  return PRODUCTS.every(k=>['','done','skip'].includes(value.products[k]));
}
// Bind only the existing WingTung questionnaire record. The deployment freezes the
// actual account ID; later registrations and display-name changes cannot gain access.
export async function bindWingTung(pool, unseal) {
  if ((await pool.query("SELECT user_id FROM hd_app_access WHERE app_key='wingtung-daily'")).rows.length) return;
  const rows = (await pool.query('SELECT u.id,u.name,r.answers_ciphertext FROM "user" u JOIN hd_record r ON r.user_id=u.id WHERE COALESCE(u.role,\'user\') <> \'admin\' AND u."createdAt" < \'2026-11-23T00:00:00Z\'')).rows;
  const normalize = s => String(s || '').toLowerCase().replace(/[^a-z]/g,'');
  const candidates = rows.filter(r=>[r.name,unseal(r.answers_ciphertext).clientName].some(n=>['laiwingtung','wingtunglai','mslai'].includes(normalize(n).replace(/s?record$/, ''))));
  if (candidates.length !== 1) { console.error('Tracker binding: '+candidates.length+' matching accounts across '+rows.length+' existing questionnaires.'); throw new Error('Tracker requires exactly one existing WingTung account'); }
  await pool.query("INSERT INTO hd_app_access(app_key,user_id) VALUES('wingtung-daily',$1) ON CONFLICT DO NOTHING", [candidates[0].id]);
}
export function trackerRoutes({pool,seal,unseal,body,audit,photoArchive}) {
  return async (request,path,user) => {
    const grant=(await pool.query('SELECT a.user_id,u.name FROM hd_app_access a JOIN "user" u ON u.id=a.user_id WHERE a.app_key=$1',['wingtung-daily'])).rows[0];
    if (!grant || (user.role!=='admin' && grant.user_id!==user.id)) return Response.json({error:'此打卡服務現階段供指定客戶使用。請聯絡跟進者確認帳戶。'},{status:403});
    const respond=(v,status=200)=>Response.json(v,{status});
    if(path.startsWith('/tracker/photos/') && request.method==='GET'){
      if(!photoArchive)return respond({error:'圖片服務尚未連接'},503);
      return photoArchive.download(path.slice('/tracker/photos/'.length),{userId:grant.user_id,actorId:user.id,isAdmin:user.role==='admin'});
    }
    const previewDays=path==='/tracker/preview-days'||path.startsWith('/tracker/preview-days/');
    const table=previewDays?'hd_daily_preview':'hd_daily';
    const subjectId=previewDays?user.id:grant.user_id;
    const format = r=>({date:typeof r.day==='string'?r.day.slice(0,10):r.day.toISOString().slice(0,10),version:r.version,updatedAt:r.updated_at,content:unseal(r.content_ciphertext)});
    if((path==='/tracker/preview-script'||path==='/tracker/daily-script') && request.method==='GET') {
      return new Response(await readFile(new URL('./tracker-preview.mjs',import.meta.url),'utf8'),{headers:{'content-type':'application/javascript; charset=utf-8','x-robots-tag':'noindex, nofollow, noarchive'}});
    }
    if((path==='/tracker/preview'||path==='/tracker/daily') && request.method==='GET') {
      const html=path==='/tracker/daily'?await readFile(new URL('./tracker-daily.html',import.meta.url),'utf8'):await readFile(new URL('./tracker-preview.html',import.meta.url),'utf8');
      return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','x-robots-tag':'noindex, nofollow, noarchive','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",'referrer-policy':'same-origin'}});
    }
    if(path==='/tracker' && request.method==='GET') return respond({accountId:user.id,clientName:grant.name,admin:user.role==='admin',photoStorageReady:!photoArchive||photoArchive.configured,start:'2026-11-23',end:'2026-12-22'});
    if((path==='/tracker/days'||path==='/tracker/preview-days') && request.method==='GET') {
      let rows=(await pool.query(`SELECT * FROM ${table} WHERE user_id=$1 ORDER BY day DESC`,[subjectId])).rows;
      if(previewDays){const actual=(await pool.query('SELECT * FROM hd_daily WHERE user_id=$1 ORDER BY day DESC',[grant.user_id])).rows;const merged=new Map(actual.map(r=>[format(r).date,{...r,version:0}]));for(const r of rows)merged.set(format(r).date,r);rows=[...merged.values()].sort((a,b)=>format(b).date.localeCompare(format(a).date));}
      return respond({days:rows.map(r=>{const d=format(r);for(const meal of Object.values(d.content.meals))meal.photos=meal.photos.map(()=>true);return d;})});
    }
    const match=path.match(/^\/tracker\/(?:days|preview-days)\/(\d{4}-\d{2}-\d{2})$/);
    if(!match || !validDay(match[1])) return respond({error:'日期不在本期記錄範圍內' },400);
    const day=match[1];
    if(request.method==='GET') {
      let row=(await pool.query(`SELECT * FROM ${table} WHERE user_id=$1 AND day=$2`,[subjectId,day])).rows[0];
      if(previewDays&&!row){const actual=(await pool.query('SELECT * FROM hd_daily WHERE user_id=$1 AND day=$2',[grant.user_id,day])).rows[0];if(actual)row={...actual,version:0};}
      return respond(row?format(row):{date:day,version:0,content:null});
    }
    if(request.method!=='PUT')return respond({error:'不支援此操作'},405);
    const v=await body(request);
    if(v.accountId!==user.id)return respond({error:'登入帳戶已改變，請以原有帳戶重新登入。',code:'SESSION_CHANGED'},409);
    if(!Number.isSafeInteger(v.version)||v.version<0||!validateDaily(v.content,{maxPhotos:8}))return respond({error:'請檢查數值、文字及相片大小後再儲存。'},400);
    if(photoArchive){
      const previous=(await pool.query(`SELECT content_ciphertext FROM ${table} WHERE user_id=$1 AND day=$2`,[subjectId,day])).rows[0];
      if(previous){const oldContent=unseal(previous.content_ciphertext);if(Object.values(oldContent.meals).some(m=>m.photos.some(p=>p.startsWith('data:image/'))))await photoArchive.archive(oldContent,{userId:subjectId,day,kind:previewDays?'preview':'actual',sourceUserId:grant.user_id});}
      v.content=await photoArchive.archive(v.content,{userId:subjectId,day,kind:previewDays?'preview':'actual',sourceUserId:grant.user_id});
    }
    else if(Object.values(v.content.meals).some(m=>m.photos.some(p=>p.startsWith(PHOTO_PREFIX))))return respond({error:'圖片索引未能核實'},400);
    let rows;
    if(v.version===0) rows=(await pool.query(`INSERT INTO ${table}(user_id,day,content_ciphertext) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`,[subjectId,day,seal(v.content)])).rows;
    else rows=(await pool.query(`UPDATE ${table} SET content_ciphertext=$3,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND day=$2 AND version=$4 RETURNING *`,[subjectId,day,seal(v.content),v.version])).rows;
    if(!rows.length)return respond({error:'另一個頁面已更新此日紀錄。請先匯出目前內容，再重新載入。',code:'VERSION_CONFLICT'},409);
    await audit(user.id,previewDays?'save_daily_preview':'save_daily',day);
    return respond(format(rows[0]));
  };
}
