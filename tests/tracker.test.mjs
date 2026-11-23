import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createApplication} from '../server/app.mjs';
import {bindWingTung,validateDaily} from '../server/tracker.mjs';
let db,app,owner,other,admin;
const origin='http://localhost:3010';
async function req(path,actor,method='GET',body){return app.fetch(new Request(origin+'/api/health-intake'+path,{method,headers:{origin,...(actor?{cookie:actor.cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));}
async function account(name,email){const x=await app.auth.api.signUpEmail({body:{name,email,password:'Daily-test-password-123!'}});const r=await req('/auth/sign-in/email',null,'POST',{email,password:'Daily-test-password-123!'});assert.equal(r.status,200);return{id:x.user.id,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
const content=()=>({...Object.fromEntries(['weight','sbp','dbp','sleep','activity','stress','stoolCount','stoolType','comfort','notes','intake'].map(k=>[k,''])),meals:Object.fromEntries(['breakfast','lunch','snack','dinner'].map(k=>[k,{note:'',photos:[]}])),products:Object.fromEntries(['enzyme','gut','probiotic','q10','astaxanthin'].map(k=>[k,'']))});
before(async()=>{db=new PGlite();const query=async(text,params)=>{const r=await db.query(typeof text==='string'?text:text.text,params||text.values);return{...r,rowCount:r.affectedRows??r.rows.length};};const pool={query,connect:async()=>({query,release(){}})};app=createApplication({pool,origin,secret:'tracker-integration-secret-with-32-characters',production:false});await app.initialize();owner=await account('WingTung Lai','wingtung@example.test');other=await account('WingTung Lai','other@example.test');admin=await account('管理員','admin-daily@example.test');await query('UPDATE "user" SET role=\'admin\' WHERE id=$1',[admin.id]);await query("INSERT INTO hd_app_access(app_key,user_id) VALUES('wingtung-daily',$1)",[owner.id]);});
after(async()=>db?.close());
test('existing session works; duplicate display name never grants access',async()=>{assert.equal((await req('/tracker')).status,401);assert.equal((await req('/tracker',other)).status,403);assert.equal((await req('/tracker',owner)).status,200);assert.equal((await req('/tracker',admin)).status,200);});
test('daily text and photos persist encrypted; stale versions and wrong accounts fail',async()=>{const c=content();c.weight='39.2';c.meals.breakfast.note='雞蛋與粥';c.meals.breakfast.photos=['data:image/jpeg;base64,/9j/4P/Z'];const save=await req('/tracker/days/2026-11-23',owner,'PUT',{accountId:owner.id,version:0,content:c});assert.equal(save.status,200,await save.clone().text());const d=await save.json();assert.equal(d.version,1);assert.equal((await req('/tracker/days/2026-11-23',other)).status,403);const read=await(await req('/tracker/days/2026-11-23',owner)).json();assert.deepEqual(read.content,c);const row=(await db.query('SELECT * FROM hd_daily')).rows[0];assert.ok(!row.content_ciphertext.includes('雞蛋'));assert.ok(!row.content_ciphertext.includes('/9j/'));assert.equal((await req('/tracker/days/2026-11-23',owner,'PUT',{accountId:owner.id,version:0,content:c})).status,409);assert.equal((await req('/tracker/days/2026-11-23',owner,'PUT',{accountId:other.id,version:1,content:c})).status,409);const list=await(await req('/tracker/days',admin)).json();assert.deepEqual(list.days[0].content.meals.breakfast.photos,[true]);assert.equal((await req('/tracker/days/2026-11-23',owner,'PUT',{accountId:owner.id,version:1,content:{...c,notes:'<script>'}})).status,400);});
test('rejects invalid dates, out-of-range values, extra fields and external photos',async()=>{assert.equal((await req('/tracker/days/2026-11-31',owner)).status,400);assert.equal((await req('/tracker/days/2026-12-23',owner)).status,400);let c=content();c.weight='999';assert.equal(validateDaily(c),false);c=content();c.userId=other.id;assert.equal(validateDaily(c),false);c=content();c.meals.breakfast.photos=['https://example.test/image.jpg'];assert.equal(validateDaily(c),false);assert.equal((await app.fetch(new Request(origin+'/api/health-intake/tracker/days/2026-11-23',{method:'PUT',headers:{cookie:owner.cookie,origin:'http://evil.test','content-type':'application/json'},body:'{}'}))).status,403);});
test('initial binding freezes one matching submitted account and fails closed on ambiguity',async()=>{let inserted=null;const pool={query:async(sql,args)=>{if(sql.startsWith('SELECT user_id'))return{rows:[]};if(sql.startsWith('SELECT u.id'))return{rows:[{id:'existing-owner',name:'Lai Wing Tung',answers_ciphertext:'{}'}]};inserted=args[0];return{rows:[]};}};await bindWingTung(pool,JSON.parse);assert.equal(inserted,'existing-owner');const ambiguous={query:async sql=>({rows:sql.startsWith('SELECT user_id')?[]:[{id:'a',name:'WingTung Lai',answers_ciphertext:'{}'},{id:'b',name:'WingTung Lai',answers_ciphertext:'{}'}]})};await assert.rejects(()=>bindWingTung(ambiguous,JSON.parse));});

test('original preview page and audio script require the same client permission',async()=>{
 for(const path of ['/tracker/preview','/tracker/preview-script']){
  assert.equal((await req(path)).status,401);
  assert.equal((await req(path,other)).status,403);
  const r=await req(path,owner);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);
 }
 const c=content();c.sleep='8';c.activity='15';c.stoolCount='3';c.products.enzyme='done';
 c.original={enzymeMl:20,intakePct:75,stoolCountLabel:'3次或以上',reminder:{morning:'08:00',evening:'20:30',onboarded:true,phoneEnabled:false,emailEnabled:false,tasksEnabled:true,phone:'',email:''}};
 const r=await req('/tracker/days/2026-11-24',owner,'PUT',{accountId:owner.id,version:0,content:c});assert.equal(r.status,200,await r.clone().text());assert.deepEqual((await r.json()).content,c);
 c.original.reminder.secret='extra';assert.equal(validateDaily(c),false);
});

test('preview interactions persist separately and keep customer actual records intact',async()=>{
 const before=await(await req('/tracker/days/2026-11-23',owner)).json();
 const initial=await(await req('/tracker/preview-days/2026-11-23',admin)).json();assert.equal(initial.version,0);assert.deepEqual(initial.content,before.content);
 const c=structuredClone(initial.content);c.notes='管理員聲效預覽測試';
 const saved=await req('/tracker/preview-days/2026-11-23',admin,'PUT',{accountId:admin.id,version:0,content:c});assert.equal(saved.status,200);
 assert.deepEqual(await(await req('/tracker/days/2026-11-23',owner)).json(),before);
 assert.equal((await(await req('/tracker/preview-days/2026-11-23',admin)).json()).content.notes,'管理員聲效預覽測試');
 assert.deepEqual((await(await req('/tracker/preview-days/2026-11-23',owner)).json()).content,before.content);
 assert.equal((await req('/tracker/preview-days/2026-11-23',other)).status,403);
});
