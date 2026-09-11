import {textHashP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {failYxx,publicRefYxx,validateYxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';

export function createYxxMemberAuthorizer({pool,oauth,config}){
  const c=validateYxxEntryConfig(config);
  if(!c.enabled||!oauth?.enabled||typeof oauth.authenticate!=='function'
    ||oauth.scope?.corpId!==c.corpId||oauth.scope?.agentId!==c.agentId)failYxx('CONFIG_INVALID');
  let inFlight=0,closed=false;
  function authenticate(sessionToken){
    if(closed)failYxx('UNAVAILABLE');
    let member;try{member=oauth.authenticate(sessionToken);}catch{failYxx('AUTH_REQUIRED');}
    if(member.corpId!==c.corpId)failYxx('MEMBER_REQUIRED');
    if(c.identityMode!=='VERIFIED_SAME_NAMESPACE')failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
    return member;
  }
  async function authorize(tx,member,publicRef){
    publicRefYxx(publicRef);
    const q=await tx.query(`SELECT r.ticket_id::text,r.public_ref,r.reporter_binding_hash,
      i.source_provider,i.source_bot_id,i.reporter_wecom_userid
      FROM pilot_ticket.reporter_public_ref r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
      JOIN intake.service_intake i ON i.id=t.source_intake_id
      LEFT JOIN intake.contact_journey j ON j.id=r.journey_id
      WHERE r.public_ref=$1 AND r.status='ACTIVE' AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND (r.journey_id IS NULL OR j.retention_until_epoch_ms>platform.physical_epoch_ms())
      FOR SHARE OF r,t,i`,[publicRef]);
    const row=q.rows[0];
    if(!row||row.source_provider!=='WECOM_AIBOT'||row.source_bot_id!==c.botId||row.reporter_wecom_userid!==member.userid
      ||row.reporter_binding_hash!==textHashP2016(JSON.stringify(['WECOM_AIBOT',c.botId,member.userid])))return null;
    return Object.freeze({ticket_id:row.ticket_id,public_ref:row.public_ref,session_id:null});
  }
  async function run({sessionToken,publicRef=null,locator=null,access=null},reader){
    const member=authenticate(sessionToken);
    if(inFlight>=32)failYxx('BUSY');inFlight++;
    try{
      const result=await transactionP2016(pool,async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await tx.query("SET LOCAL statement_timeout='2000ms'");
        await tx.query("SET LOCAL lock_timeout='2000ms'");
        let ref=publicRef;
        if(locator){try{ref=await access.locateLegacyInTransaction({transaction:tx,locator});}catch(error){
          if(error?.code!=='P2_016_GRANT_INVALID')throw error;
          await tx.query("INSERT INTO pilot_ticket.reporter_access_event(event_type,reason_code) VALUES('ACCESS_DENIED','MEMBER_ENTRY_DENIED')");return null;
        }}
        const scope=await authorize(tx,member,ref);
        if(!scope){await tx.query("INSERT INTO pilot_ticket.reporter_access_event(event_type,reason_code) VALUES('ACCESS_DENIED','MEMBER_ENTRY_DENIED')");return null;}
        const value=await reader(tx,scope);
        authenticate(sessionToken); // Reject an identity revoked while the transaction awaited I/O.
        return {value};
      });
      authenticate(sessionToken);
      if(!result)failYxx('NOT_FOUND');return result.value;
    }finally{inFlight--;}
  }
  return Object.freeze({authenticate,read:(input,reader)=>run(input,reader),
    locate:input=>run(input,async(_tx,scope)=>scope.public_ref),close(){closed=true;}});
}
