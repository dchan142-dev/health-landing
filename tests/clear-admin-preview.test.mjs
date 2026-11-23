import{test}from'node:test';import assert from'node:assert/strict';import{PGlite}from'@electric-sql/pglite';import{clearAdminPreview}from'../scripts/clear-admin-preview.mjs';
test('cleanup deletes only the named admin sandbox, verifies zero, and never repeats',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY,email TEXT,role TEXT);CREATE TABLE hd_audit(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT);CREATE TABLE hd_daily_preview(user_id TEXT,content TEXT);CREATE TABLE hd_daily(user_id TEXT,content TEXT);');
 await db.exec(`INSERT INTO "user" VALUES('owner','dchan142@gmail.com','admin'),('other-admin','other@example.test','admin'),('client','client@example.test','user');INSERT INTO hd_daily_preview VALUES('owner','test photo and notes'),('owner','another test'),('other-admin','keep other tests'),('client','keep client preview');INSERT INTO hd_daily VALUES('client','actual health records');`);
 const query=async(t,p)=>{const r=await db.query(t,p);return{...r,rowCount:r.affectedRows??r.rows.length}};const pool={connect:async()=>({query,release(){}})};
 const result=await clearAdminPreview(pool,{email:'dchan142@gmail.com',operationId:'clear-once'});assert.deepEqual(result,{alreadyApplied:false,deleted:2,remaining:0});
 assert.equal((await db.query('SELECT * FROM hd_daily')).rows[0].content,'actual health records');assert.deepEqual((await db.query('SELECT user_id FROM hd_daily_preview ORDER BY user_id')).rows.map(r=>r.user_id),['client','other-admin']);
 await db.exec("INSERT INTO hd_daily_preview VALUES('owner','new future test')");const again=await clearAdminPreview(pool,{email:'dchan142@gmail.com',operationId:'clear-once'});assert.equal(again.alreadyApplied,true);assert.equal((await db.query("SELECT count(*) AS n FROM hd_daily_preview WHERE user_id='owner'")).rows[0].n,1);
 await assert.rejects(()=>clearAdminPreview(pool,{email:'client@example.test',operationId:'invalid-user'}));assert.equal((await db.query("SELECT count(*) AS n FROM hd_audit WHERE id='invalid-user'")).rows[0].n,0);
 }finally{await db.close();}
});
