const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'];
const PRODUCTS = ['enzyme', 'gut', 'probiotic', 'q10', 'astaxanthin'];
export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= '2026-11-23' && day <= '2026-12-22' && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
}
export function validateDaily(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['weight','sbp','dbp','sleep','activity','stress','stoolCount','stoolType','comfort','notes','meals','products','intake'];
  if (Object.keys(value).some(k => !keys.includes(k))) return false;
  for (const k of keys.filter(k => !['meals','products'].includes(k))) {
    if (typeof value[k] !== 'string' || value[k].length > (k === 'notes' ? 2000 : 100) || /[<>]/.test(value[k])) return false;
  }
  for (const [k,min,max] of [['weight',20,150],['sbp',50,250],['dbp',25,160],['sleep',0,24],['activity',0,600],['stoolCount',0,30]]) {
    if (value[k] !== '' && (!/^\d+(\.\d+)?$/.test(value[k]) || Number(value[k]) < min || Number(value[k]) > max)) return false;
  }
  if (!value.meals || Object.keys(value.meals).length !== 4 || !value.products || Object.keys(value.products).length !== 5) return false;
  for (const k of MEALS) {
    const meal = value.meals[k];
    if (!meal || Object.keys(meal).some(k=>!['note','photos'].includes(k)) || typeof meal.note !== 'string' || meal.note.length > 1000 || /[<>]/.test(meal.note) || !Array.isArray(meal.photos) || meal.photos.length > 2) return false;
    for (const photo of meal.photos) {
      if (typeof photo !== 'string' || photo.length > 100000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo)) return false;
      const bytes = Buffer.from(photo.slice(23),'base64');
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
    }
  }
  return PRODUCTS.every(k=>['','done','skip'].includes(value.products[k]));
}
// Bind only the existing, submitted WingTung record. The deployment freezes the
// actual account ID; later registrations and display-name changes cannot gain access.
export async function bindWingTung(pool, unseal) {
  if ((await pool.query("SELECT user_id FROM hd_app_access WHERE app_key='wingtung-daily'")).rows.length) return;
  const rows = (await pool.query('SELECT u.id,u.name,r.answers_ciphertext FROM "user" u JOIN hd_record r ON r.user_id=u.id WHERE r.status=\'submitted\' AND COALESCE(u.role,\'user\') <> \'admin\' AND u."createdAt" < \'2026-11-23T00:00:00Z\'')).rows;
  const normalize = s => String(s || '').toLowerCase().replace(/[^a-z]/g,'');
  const candidates = rows.filter(r=>[r.name,unseal(r.answers_ciphertext).clientName].some(n=>['laiwingtung','wingtunglai'].includes(normalize(n))));
  if (candidates.length !== 1) throw new Error('Tracker requires exactly one existing WingTung account');
  await pool.query("INSERT INTO hd_app_access(app_key,user_id) VALUES('wingtung-daily',$1) ON CONFLICT DO NOTHING", [candidates[0].id]);
}
export function trackerRoutes({pool,seal,unseal,body,audit}) {
  return async (request,path,user) => {
    const grant=(await pool.query('SELECT a.user_id,u.name FROM hd_app_access a JOIN "user" u ON u.id=a.user_id WHERE a.app_key=$1',['wingtung-daily'])).rows[0];
    if (!grant || (user.role!=='admin' && grant.user_id!==user.id)) return Response.json({error:'此打卡服務現階段供指定客戶使用。請聯絡跟進者確認帳戶。'},{status:403});
    const respond=(v,status=200)=>Response.json(v,{status});
    const format = r=>({date:typeof r.day==='string'?r.day.slice(0,10):r.day.toISOString().slice(0,10),version:r.version,updatedAt:r.updated_at,content:unseal(r.content_ciphertext)});
    if(path==='/tracker' && request.method==='GET') return respond({accountId:user.id,clientName:grant.name,admin:user.role==='admin',start:'2026-11-23',end:'2026-12-22'});
    if(path==='/tracker/days' && request.method==='GET') {
      const rows=(await pool.query('SELECT * FROM hd_daily WHERE user_id=$1 ORDER BY day DESC',[grant.user_id])).rows;
      return respond({days:rows.map(r=>{const d=format(r);for(const meal of Object.values(d.content.meals))meal.photos=meal.photos.map(()=>true);return d;})});
    }
    const match=path.match(/^\/tracker\/days\/(\d{4}-\d{2}-\d{2})$/);
    if(!match || !validDay(match[1])) return respond({error:'日期不在本期記錄範圍內' },400);
    const day=match[1];
    if(request.method==='GET') {
      const row=(await pool.query('SELECT * FROM hd_daily WHERE user_id=$1 AND day=$2',[grant.user_id,day])).rows[0];
      return respond(row?format(row):{date:day,version:0,content:null});
    }
    if(request.method!=='PUT')return respond({error:'不支援此操作'},405);
    const v=await body(request);
    if(v.accountId!==user.id)return respond({error:'登入帳戶已改變，請以原有帳戶重新登入。',code:'SESSION_CHANGED'},409);
    if(!Number.isSafeInteger(v.version)||v.version<0||!validateDaily(v.content))return respond({error:'請檢查數值、文字及相片大小後再儲存。'},400);
    let rows;
    if(v.version===0) rows=(await pool.query('INSERT INTO hd_daily(user_id,day,content_ciphertext) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',[grant.user_id,day,seal(v.content)])).rows;
    else rows=(await pool.query('UPDATE hd_daily SET content_ciphertext=$3,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND day=$2 AND version=$4 RETURNING *',[grant.user_id,day,seal(v.content),v.version])).rows;
    if(!rows.length)return respond({error:'另一個頁面已更新此日紀錄。請先匯出目前內容，再重新載入。',code:'VERSION_CONFLICT'},409);
    await audit(user.id,'save_daily',day);
    return respond(format(rows[0]));
  };
}
