/** Health Decoder private Drive bridge. Deploy as the owner; signed server calls only. */
var ROOT_FOLDER_ID = 'REPLACE_ROOT_FOLDER_ID';
var EXPECTED_OWNER_EMAIL = 'dchan142@gmail.com';
var SHARED_SECRET = 'REPLACE_SHARED_SECRET';
var MEAL_LABELS = {breakfast:'早餐',lunch:'午餐',snack:'營養奶及加餐',dinner:'晚餐'};
function hex_(bytes){return bytes.map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function sha_(bytes){return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes));}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function equal_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var n=0;for(var i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function private_(item){
 if(item.isTrashed()||item.getOwner().getEmail().toLowerCase()!==EXPECTED_OWNER_EMAIL)throw Error('Private owner check');
 if(item.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Link sharing check');
 var peers=item.getEditors().concat(item.getViewers());
 if(peers.some(function(u){return u.getEmail().toLowerCase()!==EXPECTED_OWNER_EMAIL;}))throw Error('Private permission check');
 return item;
}
function root_(){return private_(DriveApp.getFolderById(ROOT_FOLDER_ID));}
function folder_(parent,name){private_(parent);var it=parent.getFoldersByName(name),result;if(it.hasNext()){result=it.next();if(it.hasNext())throw Error('Ambiguous folder');}else result=parent.createFolder(name);return private_(result);}
function inside_(item){
 private_(item);var queue=[item],visited={},steps=0;
 while(queue.length&&steps++<30){var current=queue.shift();if(current.getId()===ROOT_FOLDER_ID)return true;var parents=current.getParents();while(parents.hasNext()){var p=private_(parents.next());if(!visited[p.getId()]){visited[p.getId()]=true;queue.push(p);}}}
 throw Error('Outside archive');
}
function verify_(file,folderId){
 private_(file);inside_(file);var parentIds=[],parents=file.getParents();while(parents.hasNext())parentIds.push(parents.next().getId());
 if(folderId&&parentIds.indexOf(folderId)<0)throw Error('Folder mismatch');
 var bytes=file.getBlob().getBytes();return {fileId:file.getId(),folderId:folderId||parentIds[0],size:bytes.length,sha256:sha_(bytes),verified:true,private:true};
}
function upload_(payload){
 if(!payload||!/^[-\w]{1,128}$/.test(payload.clientKey)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.day)||['actual','preview'].indexOf(payload.kind)<0||!Array.isArray(payload.photos)||payload.photos.length>32)throw Error('Invalid upload');
 var client=payload.kind==='actual'?folder_(root_(),'WingTung Lai'):folder_(folder_(root_(),'預覽測試'),payload.clientKey);
 var date=folder_(client,payload.day),result=[];
 payload.photos.forEach(function(p){
  if(!MEAL_LABELS[p.meal]||!/^\w{64}$/.test(p.sha256)||typeof p.base64!=='string'||p.base64.length>100000)throw Error('Invalid photo');
  var bytes=Utilities.base64Decode(p.base64);
  if(bytes.length!==p.size||sha_(bytes)!==p.sha256||((bytes[0]+256)%256)!==255||((bytes[1]+256)%256)!==216||((bytes[bytes.length-2]+256)%256)!==255||((bytes[bytes.length-1]+256)%256)!==217)throw Error('Input checksum mismatch');
  var meal=folder_(date,MEAL_LABELS[p.meal]),name=payload.day+'_'+MEAL_LABELS[p.meal]+'_'+p.sha256.slice(0,20)+'.jpg',existing=meal.getFilesByName(name),file;
  if(existing.hasNext()){file=existing.next();if(existing.hasNext())throw Error('Ambiguous file');}else file=meal.createFile(Utilities.newBlob(bytes,'image/jpeg',name));
  var verified=verify_(file,meal.getId());
  if(verified.sha256!==p.sha256||verified.size!==p.size)throw Error('Drive readback checksum mismatch');
  result.push(verified);
 });return {ok:true,files:result};
}
function check_(){
 var root=root_(),file=null;
 try{var bytes=Utilities.newBlob('Health Decoder archive verification '+Utilities.getUuid()).getBytes();file=root.createFile(Utilities.newBlob(bytes,'text/plain','archive-verification.txt'));var result=verify_(file,root.getId());if(result.sha256!==sha_(bytes))throw Error('Readback failed');return{ok:true,rootFolderId:root.getId(),private:true,readWriteVerified:true};}
 finally{if(file)file.setTrashed(true);}
}
// Run setup once from the editor to grant the owner's Google Drive permissions.
function setup(){return check_();}
function doGet(){return json_({ok:false,message:'Signed server request required'});}
function doPost(e){
 var lock=null;
 try{
  if(!e||!e.postData||e.postData.contents.length>4500000)throw Error('Invalid request');
  var envelope=JSON.parse(e.postData.contents);
  if(typeof envelope.message!=='string'||!/^([a-f0-9]{64})$/.test(envelope.signature||''))throw Error('Invalid signature');
  var expected=hex_(Utilities.computeHmacSha256Signature(envelope.message,SHARED_SECRET,Utilities.Charset.UTF_8));
  if(!equal_(expected,envelope.signature))throw Error('Signature mismatch');
  var request=JSON.parse(envelope.message);
  if(Math.abs(Date.now()-request.time)>300000||!/^[-\w]{1,128}$/.test(request.nonce||''))throw Error('Expired request');
  lock=LockService.getScriptLock();lock.waitLock(30000);
  var cache=CacheService.getScriptCache(),nonce='request:'+request.nonce;if(cache.get(nonce))throw Error('Repeated request');cache.put(nonce,'1',600);
  if(request.action==='check')return json_(check_());
  if(request.action==='upload')return json_(upload_(request.payload));
  if(request.action==='verify')return json_({ok:true,files:request.payload.files.map(function(p){return verify_(DriveApp.getFileById(p.fileId),p.folderId);})});
  if(request.action==='download'){
   var file=DriveApp.getFileById(request.payload.fileId),meta=verify_(file,request.payload.folderId);
   return json_({ok:true,base64:Utilities.base64Encode(file.getBlob().getBytes()),sha256:meta.sha256,size:meta.size});
  }
  throw Error('Unknown action');
 }catch(error){return json_({ok:false,message:'Archive request could not be verified'});}
 finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
