import { readFile } from 'node:fs/promises';
import { createP2012IncidentQuery } from './p2-012-incident-query.mjs';
import { createP2012IncidentCommandService } from './p2-012-incident-command-service.mjs';
import { createP2012NotificationPolicy } from './p2-012-notification-policy.mjs';
import { createP2012RealtimeProjector } from './p2-012-realtime-projector.mjs';
import { createP2012WorkbenchHttp } from './p2-012-workbench-http.mjs';
import { createP2012ReporterTimelineAdapter } from './p2-012-reporter-timeline-adapter.mjs';
import { createP2012CandidateReviewStore } from './p2-012-candidate-source-adapter.mjs';
import { flags } from './p2-012-domain-contracts.mjs';
import { fail } from './p2-012-domain-contracts.mjs';
import { createP2016Runtime } from './p2-016-runtime.mjs';

export function createP2012Runtime({incidentFlags={},incidentLiveApproval=null,incidentTestLabel=false,...options}={}){
  if(typeof incidentTestLabel!=='boolean')fail();
  const f=flags(incidentFlags);
  if(f.INCIDENT_CORRELATION_ENABLED&&(options.gatewayEnabled||options.senderEnabled)){
    if(!['live','scope','send','publicNotice','privateNotice'].every(k=>incidentLiveApproval?.[k]===true))fail('LIVE_APPROVAL_REQUIRED',403);
  }
  return createP2016Runtime({...options,incidentExtensionFactory:context=>createP2012WorkbenchExtension({
    ...context,featureFlags:f,testLabel:incidentTestLabel||options.gatewayEnabled===true||options.senderEnabled===true})});
}
export function createP2012WorkbenchExtension({pool,realtime,featureFlags={},testLabel=false}){
  const f=flags(featureFlags),enabled=f.INCIDENT_CORRELATION_ENABLED,query=createP2012IncidentQuery({pool,enabled});
  const projector=createP2012RealtimeProjector({pool,enabled,wakeup:realtime?.wakeup});
  const notifications=createP2012NotificationPolicy({enabled,publicEnabled:f.INCIDENT_PUBLIC_NOTICE_ENABLED,privateEnabled:f.INCIDENT_PRIVATE_NOTICE_ENABLED,testLabel});
  const commands=createP2012IncidentCommandService({pool,enabled,query,notifications,realtime:projector,maintenanceEnabled:false});
  const maintenance=createP2012IncidentCommandService({pool,enabled,query,realtime:projector,maintenanceEnabled:true});
  const importer=createP2012CandidateReviewStore({pool,enabled});
  return Object.freeze({query,commands,enabled,
    async ready(){if(!enabled)return true;try{return (await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='032_p2_012_human_confirmed_incident'")).rowCount===1;}catch{return false;}},
    reporterAdapter:enabled?createP2012ReporterTimelineAdapter({pool,enabled}):null,
    authenticatedHandler:createP2012WorkbenchHttp({query,commands,enabled}),
    async staticHandler(pathname,response){
      const files={'/workbench/incidents':['incidents.html','text/html'],'/static/workbench/incidents.js':['incidents.js','text/javascript']};
      const item=files[pathname];if(!item)return false;
      if(!enabled){response.writeHead(503,{'content-type':'text/plain; charset=utf-8'});response.end('Incident 未启用');return true;}
      response.writeHead(200,{'content-type':item[1]+'; charset=utf-8','cache-control':'no-store'});response.end(await readFile(new URL('../web/p2-workbench/'+item[0],import.meta.url)));return true;
    },
    async runOnce(){
      if(!enabled)return {processed:0};
      const candidates=await pool.query(`SELECT d.id FROM intake.deterministic_decision d WHERE d.result_code='INCIDENT_REVIEW_CANDIDATE'
        AND (d.safe_result ? 'incident_candidate' OR d.safe_result->>'incident_review_candidate'='true') AND NOT EXISTS(SELECT 1 FROM incident.candidate_review c WHERE c.source_decision_id=d.id AND c.source_result_hash=d.result_hash)
        ORDER BY d.created_at,d.id LIMIT 20`);
      let imported=0,expired=0,expiration_replayed=0,expiration_race_lost=0;
      for(const d of candidates.rows)if((await importer.importDecision({decisionId:d.id})).created)imported++;
      const due=await pool.query(`SELECT id::text,row_version::text,expires_epoch_ms::text FROM incident.candidate_review
        WHERE status='CANDIDATE' AND expires_epoch_ms<=platform.physical_epoch_ms()
        ORDER BY expires_epoch_ms,id LIMIT 20`);
      for(const candidate of due.rows){
        const result=await maintenance.expireCandidate({action:'EXPIRE_CANDIDATE',candidate_review_id:candidate.id,
          expected_row_version:candidate.row_version,client_command_id:candidate.id,reason_code:'MAINTENANCE_EXPIRED'});
        if(result.ok){if(result.replayed)expiration_replayed++;else expired++;continue;}
        if(['P2_012_VERSION_CONFLICT','P2_012_STATE_CONFLICT','P2_012_EXPIRY_CONFLICT'].includes(result.error.code)){
          const current=await pool.query(`SELECT status,expires_epoch_ms<=platform.physical_epoch_ms() AS due
            FROM incident.candidate_review WHERE id=$1::uuid`,[candidate.id]);
          if(current.rowCount===1&&(current.rows[0].status!=='CANDIDATE'||!current.rows[0].due)){expiration_race_lost++;continue;}
        }
        fail('COMMAND_FAILED',503);
      }
      const projected=await projector.runOnce();
      return {...projected,imported,expired,expiration_replayed,expiration_race_lost,projected:projected.processed};
    },
  });
}
