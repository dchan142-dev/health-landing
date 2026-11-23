// One-time, audited maintenance: remove only the requesting administrator's
// sandbox records. Actual client records and client preview records are excluded.
export async function clearAdminPreview(pool, {email, operationId}) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const admins=(await client.query('SELECT id FROM "user" WHERE lower(email)=$1 AND role=$2',[email.trim().toLowerCase(),'admin'])).rows;
    if(admins.length!==1)throw new Error('Expected one existing administrator');
    const actor=admins[0].id;
    const marker=await client.query('INSERT INTO hd_audit(id,actor_id,action) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[operationId,actor,'clear_admin_preview']);
    if(!marker.rows.length){await client.query('COMMIT');return {alreadyApplied:true,deleted:0};}
    const deleted=await client.query('DELETE FROM hd_daily_preview WHERE user_id=$1',[actor]);
    const remaining=Number((await client.query('SELECT count(*) AS count FROM hd_daily_preview WHERE user_id=$1',[actor])).rows[0].count);
    if(remaining!==0)throw new Error('Preview cleanup verification failed');
    await client.query('COMMIT');
    return {alreadyApplied:false,deleted:deleted.rowCount,remaining};
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
