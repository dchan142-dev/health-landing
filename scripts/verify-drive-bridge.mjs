import{readFile}from"node:fs/promises";
import{createHash}from'node:crypto';
import{createDriveBridge}from'../server/drive-archive.mjs';
const bridge=createDriveBridge({url:process.env.HD_DRIVE_WEBAPP_URL,secret:process.env.HD_DRIVE_SHARED_SECRET});
const ready=await bridge.check();
if(ready.private!==true||ready.readWriteVerified!==true)throw Error('Drive root verification failed');
// A tiny non-clinical JPEG marker verifies the exact upload/download byte path.
const bytes=await readFile(new URL('../tests/fixtures/drive-probe.jpg',import.meta.url));
const sha256=createHash('sha256').update(bytes).digest('hex');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const result=await bridge.upload({clientKey:'system-verification',clientName:'系統驗證',kind:'preview',day,photos:[{meal:'breakfast',size:bytes.length,sha256,base64:bytes.toString('base64')}]});
const file=result.files?.[0];
if(!file?.verified||file.private!==true||file.sha256!==sha256||file.size!==bytes.length)throw Error('Drive uploaded bytes or privacy check failed');
const readback=await bridge.download({fileId:file.fileId,folderId:file.folderId});
if(!Buffer.from(readback.base64,'base64').equals(bytes))throw Error('Drive download check failed');
console.log(JSON.stringify({privateRootVerified:true,uploadVerified:true,downloadVerified:true,fileId:file.fileId,rootFolderId:ready.rootFolderId}));
