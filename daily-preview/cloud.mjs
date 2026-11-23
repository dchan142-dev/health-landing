const BASE='/api/health-intake';
const FIELDS=['weight','sbp','dbp','sleep','activity','stress','stoolCount','stoolType','comfort','notes','intake'];
const MEALS=['breakfast','lunch','snack','dinner'];
let sessionId, overlay, loginResolver;
function status(message,error=false){const e=document.getElementById('cloud-status');e.textContent=message;e.classList.toggle('text-red-700',error);}
async function api(path,options={}){
 let response;try{response=await fetch(BASE+path,{...options,credentials:'same-origin',cache:'no-store',headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(30000)});}catch{throw new Error('網絡暫時未連接，內容仍在本頁。請保持頁面開啟並重試。');}
 const value=await response.json();
 if(!response.ok){if(response.status===401)showLogin();const e=new Error(value.error||value.message||'暫時未能連接，請重試。');e.status=response.status;throw e;}return value;
}
function showLogin(){
 if(overlay){overlay.classList.remove('hidden');return;}
 overlay=document.createElement('div');overlay.className='fixed inset-0 z-[100] bg-slate-900/80 flex items-center justify-center p-4';
 overlay.innerHTML='<form class="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4"><h2 class="text-xl font-bold text-teal-900">重新登入，接續你的紀錄</h2><p class="text-sm text-slate-600">本頁未儲存的內容會保留，登入後請重試儲存。</p><label class="block">電郵<input type="email" name="email" autocomplete="username" required class="block w-full rounded border p-3 text-base"></label><label class="block">密碼<input type="password" name="password" autocomplete="current-password" required class="block w-full rounded border p-3 text-base"></label><p role="alert" class="text-sm text-red-700"></p><button class="w-full p-3 rounded-xl bg-teal-700 text-white font-bold">登入</button></form>';
 document.body.append(overlay);
 overlay.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const f=event.target,button=f.querySelector('button'),message=f.querySelector('[role=alert]');button.disabled=true;try{await api('/auth/sign-in/email',{method:'POST',body:JSON.stringify({email:f.elements.email.value.trim(),password:f.elements.password.value})});f.elements.password.value='';const p=await api('/tracker');if(p.accountId!==sessionId)throw new Error('請使用原有帳戶登入，接續本頁紀錄。');overlay.classList.add('hidden');status('已重新登入，請按儲存接續。');loginResolver?.();}catch(e){message.textContent=e.message;}finally{button.disabled=false;}});
}
function fromCanonical(day){const c=day.content;return{date:day.date,enzymeMl:c.original?.enzymeMl??null,probioticDone:c.products.probiotic==='done',gutDone:c.products.gut==='done',astaDone:c.products.astaxanthin==='done',q10Done:c.products.q10==='done',weight:c.weight,sbp:c.sbp,dbp:c.dbp,intakePct:c.original?.intakePct??(/^\d+%$/.test(c.intake)?parseInt(c.intake):null),comfort:c.comfort,stoolCount:c.original?.stoolCountLabel??(c.stoolCount===''?'':Number(c.stoolCount)>=3?'3次或以上':c.stoolCount+'次'),stoolType:c.stoolType,notes:c.notes,meals:structuredClone(c.meals),updatedAt:day.updatedAt};}
function toCanonical(record,existing,reminder){const value=existing?structuredClone(existing):{...Object.fromEntries(FIELDS.map(k=>[k,''])),meals:{},products:{}};
 for(const k of ['weight','sbp','dbp','stoolCount','stoolType','comfort','notes'])value[k]=String(record[k]??'');
 value.meals=structuredClone(record.meals);
 if(record.intakePct!==null)value.intake=String(record.intakePct)+'%';
 const completed={enzyme:record.enzymeMl>0,probiotic:record.probioticDone,gut:record.gutDone,q10:record.q10Done,astaxanthin:record.astaDone};
 if(existing && record.stoolCount===fromCanonical({date:record.date,content:existing}).stoolCount)value.stoolCount=existing.stoolCount;else value.stoolCount=record.stoolCount===''?'':String(parseInt(record.stoolCount,10));
 for(const[k,done]of Object.entries(completed))value.products[k]=done?'done':value.products[k]==='skip'?'skip':'';
 if(record.enzymeMl===null && existing?.products.enzyme==='done')value.products.enzyme='done';
 value.original={stoolCountLabel:record.stoolCount,enzymeMl:record.enzymeMl??null,intakePct:record.intakePct??null,reminder:reminder||{}};
 return value;
}
export async function bootCloud(){
 const profile=await api('/tracker');sessionId=profile.accountId;
 const index=await api('/tracker/preview-days'),cache=new Map(),records={};
 // Limit concurrent photo requests. Actual dates are fully loaded for the original
 // history gallery, charts and CSV; health data stays out of persistent browser storage.
 for(let i=0;i<index.days.length;i+=3){await Promise.all(index.days.slice(i,i+3).map(async row=>{const d=await api('/tracker/preview-days/'+row.date);cache.set(d.date,d);records[d.date]=fromCanonical(d);}));}
 const mostRecent=[...cache.values()].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).find(d=>d.content.original?.reminder);
 const cloud={records,reminder:mostRecent?.content.original.reminder||null,ready:false,loading:false,photosBusy:false,status,
  async refreshDay(date){const d=await api('/tracker/preview-days/'+date);cache.set(date,d);if(d.content)records[date]=fromCanonical(d);else delete records[date];},
  async save(record,reminder){
   status('正在儲存到雲端…');
   try{let old=cache.get(record.date);if(!old){old=await api('/tracker/preview-days/'+record.date);cache.set(record.date,old);}
    const saved=await api('/tracker/preview-days/'+record.date,{method:'PUT',body:JSON.stringify({accountId:sessionId,version:old.version,content:toCanonical(record,old.content,reminder)})});cache.set(record.date,saved);status('已儲存至雲端預覽 · '+new Date(saved.updatedAt).toLocaleTimeString('zh-HK',{timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit'}));document.getElementById('cloud-backup').classList.add('hidden');return saved;
   }catch(e){status(e.message+' 本頁內容已保留，可重試儲存或下載備份。',true);document.getElementById('cloud-backup').classList.remove('hidden');throw e;}
  },
  backup(record){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));link.href=url;link.download='Ms-Lai-'+record.date+'-未儲存備份.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);},
  async logout(){try{await api('/auth/sign-out',{method:'POST',body:'{}'});location.replace('/daily-preview/');}catch(e){status(e.message,true);}}
 };
 status('已連接原有帳戶 · 預覽記錄獨立保存，正式紀錄保持完整');return cloud;
}
