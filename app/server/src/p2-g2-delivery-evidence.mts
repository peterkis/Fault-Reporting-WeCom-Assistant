import type {G2Manifest} from './p2-g2-validation-config.mjs';
import type {G2EvidenceSource,G2EvidenceRecord} from './p2-g2-evidence.mjs';
import type {G2SourceReference} from './p2-g2-evidence-files.mjs';
import type {ReconciliationDelivery,ReconciliationAttempt,ReconciliationCounts} from './p2-g2-reconciliation.mjs';
import type {ProviderReceipt,ProviderReceiptRow} from './p2-g2-provider-receipts.mjs';
import type {StoredWebhookReceipt,WebhookReceiptRow} from './p2-g2-webhook-receipts.mjs';
type SourceInput = {ref:unknown;sha256:unknown};
type DeliveryProofInput = {schema_version?:unknown;kind?:unknown;run_id?:unknown;candidate_fingerprint?:unknown;scenario_id?:unknown;delivery_ref_hashes?:unknown;receipts?:unknown;snapshot:SourceInput;startup:SourceInput;controls?:unknown;synthetic_fault_basis?:SourceInput};
type SnapshotInput = Record<string,unknown> & {counts:ReconciliationCounts;deliveries:ReconciliationDelivery[];attempts:ReconciliationAttempt[];ticket_events:Record<string,unknown>[];incident_events?:Record<string,unknown>[];reports?:Record<string,unknown>[]};
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { G2_ROOT } from './p2-g2-candidate.mjs';
import { g2Hash, failG2 } from './p2-g2-validation-config.mjs';
import { G2_CLIENT_SCENARIOS } from './p2-g2-gate-evaluator.mjs';
import { G2_RECONCILIATION_QUERY_HASH } from './p2-g2-reconciliation.mjs';
import { g2StartupFacts } from './p2-g2-live-evidence.mjs';
import { readG2SourceFile, readG2SourceJson, readG2PacketSource, g2SourceMatches } from './p2-g2-evidence-files.mjs';
import { readG2ProviderReceipts } from './p2-g2-provider-receipts.mjs';
import { readG2WebhookReceipts } from './p2-g2-webhook-receipts.mjs';
import { incidentNotificationTemplates } from './p2-012-notification-policy.mjs';
import { deriveG2TestEvidence } from './p2-g2-test-evidence.mjs';

function scenarioMatches({proof,manifest,snapshot,delivery:d,receipt,root}: {proof:DeliveryProofInput;manifest:G2Manifest;snapshot:SnapshotInput;delivery:ReconciliationDelivery;receipt:ProviderReceipt|StoredWebhookReceipt;root:string}){
  const ticketEvent=(snapshot.ticket_events??[]).find(e=>e.event_id===d.source_event_ref&&e.ticket_id===d.ticket_id&&e.event_type===d.source_event_type);
  const privateTicket=d.audience==='PERSON'&&d.destination_eligible_at_reconciliation===true&&Boolean(ticketEvent)
    &&(d.source_event_type==='ticket.accepted'&&d.notification_type==='TICKET_ACCEPTED'
      ||d.source_event_type==='ticket.closed'&&d.notification_type==='TICKET_CLOSED'
      ||d.source_event_type==='ticket.created'&&d.notification_type==='TICKET_CREATED'&&(manifest.scope.ticket_notification_additional_events??[]).includes('ticket.created'));
  const groupCreated=d.audience==='GROUP'&&d.notification_type==='TICKET_CREATED'&&d.source_event_type==='ticket.created'&&Boolean(ticketEvent);
  const events=(snapshot.incident_events??[]).filter(e=>e.incident_id===d.incident_id&&e.actor_kind==='HUMAN');
  const incidentEvent=events.find(e=>e.id===d.source_event_ref&&e.event_type===d.source_event_type);
  const incidentNotice=Boolean(incidentEvent)&&incidentNotificationTemplates(d.source_event_type as string).includes(d.template_code as string)
    &&(d.audience==='GROUP'?d.incident_audience==='GROUP'&&(d.template_code as string).endsWith('_GROUP')
      :d.destination_eligible_at_reconciliation===true&&d.incident_audience==='REPORTER_DIRECT'&&(d.template_code as string).endsWith('_DIRECT'));
  switch(proof.scenario_id){
    case 'G2-E01':return groupCreated&&d.old_private_created_artifacts===0;
    case 'G2-E02':return d.audience==='GROUP'&&d.sender_system_code==='RULE_FIRST_ORCHESTRATOR'
      &&d.source_action_type==='REQUEST_ONE_DESCRIPTION'&&['EXECUTED','REPLAYED'].includes(d.source_action_state as string)&&d.source_decision_result==='NEEDS_DESCRIPTION';
    case 'G2-E03':return privateTicket&&d.origin_channel==='WECOM_GROUP'&&(d.direct_guided_leg_count as number)>0;
    case 'G2-E04':return privateTicket&&d.entry_mode==='DIRECT_ORGANIC'&&(d.direct_leg_count as number)>0&&d.organic_without_prior_group===true;
    case 'G2-E05':return privateTicket&&(d.journey_message_count as number)>=2;
    case 'G2-N02':return privateTicket&&d.origin_channel==='WECOM_GROUP'&&(d.direct_guided_leg_count as number)>0&&d.old_private_created_artifacts===0;
    case 'G2-N04':return privateTicket&&d.message_type==='template_card'&&d.consumed_grants===1;
    case 'G2-T01':{
      if(!ticketEvent||d.source_event_type!=='ticket.closed'||d.notification_type!=='TICKET_CLOSED')return false;
      const required=['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','IN_PROGRESS','WAITING_VENDOR','IN_PROGRESS','RESOLVED','CLOSED','REOPENED','IN_PROGRESS','RESOLVED','CLOSED'];
      let matched=0;for(const e of snapshot.ticket_events.filter(e=>e.ticket_id===d.ticket_id))if(e.new_status===required[matched])matched++;
      return matched===required.length&&(privateTicket||d.audience==='GROUP'&&d.transport==='WECOM_GROUP_WEBHOOK');
    }
    case 'G2-I01':return incidentNotice&&d.source_event_type==='incident.confirmed';
    case 'G2-I02':return incidentNotice&&events.some(e=>e.event_type==='incident.report.unlinked'
      &&events.some(prior=>prior.event_type==='incident.report.linked'&&prior.report_id===e.report_id)
      &&snapshot.reports?.some(r=>r.id===e.report_id&&r.incident_id===d.incident_id&&r.ticket_id
        &&snapshot.ticket_events?.some(t=>t.ticket_id===r.ticket_id)));
    case 'G2-I03':return incidentNotice&&d.audience==='PERSON'&&events.some(e=>e.event_type==='incident.report.recovered'&&e.report_id===d.incident_report_ref)
      &&snapshot.reports?.some(r=>r.id===d.incident_report_ref&&r.impact_state==='RECOVERED')
      &&snapshot.reports?.some(r=>r.incident_id===d.incident_id&&r.id!==d.incident_report_ref&&r.impact_state==='IMPACTED');
    case 'G2-N03':{
      if(!proof.synthetic_fault_basis)return false;
      const basis=readG2SourceJson(proof.synthetic_fault_basis.ref,{root,sha256:proof.synthetic_fault_basis.sha256 as string});
      return deriveG2TestEvidence(basis,manifest,{root}).some(e=>e.scenario_id==='G2-N03'&&e.result==='PASS');
    }
    case 'G2-F01':{
      if(!manifest.scope.allowed_faults.includes('G2-F01')||!Array.isArray(proof.controls)||proof.controls.length!==2)return false;
      const [off,on]=(proof.controls as unknown[]).map(s=>readG2PacketSource(s as G2SourceReference,{root}) as Record<string,unknown>);
      if([off,on].some(p=>(p as Record<string,unknown>).kind!=='G2_CONTROL_PACKET'||!g2SourceMatches(p,manifest)
        ||(p as Record<string,unknown>).schema_version!==1||!Number.isSafeInteger((p as Record<string,unknown>).sequence)||((p as Record<string,unknown>).sequence as number)<1
        ||BigInt((p as Record<string,unknown>).started_physical_epoch_ms as string)<BigInt(manifest.approval.valid_from_epoch_ms)
        ||BigInt((p as Record<string,unknown>).physical_epoch_ms as string)>=BigInt(manifest.approval.expires_epoch_ms)||BigInt((p as Record<string,unknown>).physical_epoch_ms as string)<BigInt((p as Record<string,unknown>).started_physical_epoch_ms as string)
        ||(p as Record<string,unknown>).scenario_id!=='G2-F01'||(p as Record<string,unknown>).role!=='GATEWAY')||(off as Record<string,unknown>).action!=='disconnect'||(on as Record<string,unknown>).action!=='reconnect'
        ||(off as Record<string,unknown>).gateway_authenticated!==false||(on as Record<string,unknown>).gateway_authenticated!==true||((off as Record<string,unknown>).sequence as number)>=((on as Record<string,unknown>).sequence as number)
        ||BigInt((off as Record<string,unknown>).physical_epoch_ms as string)>BigInt((on as Record<string,unknown>).started_physical_epoch_ms as string)||BigInt(receipt.physical_epoch_ms as string)<BigInt((on as Record<string,unknown>).started_physical_epoch_ms as string))return false;
      return snapshot.attempts.some(a=>a.delivery_ref_hash===d.delivery_ref_hash&&a.outcome==='RETRY_SCHEDULED'&&a.side_effect_state==='NOT_ATTEMPTED'
        &&['GATEWAY_UNAVAILABLE','GATEWAY_UNAVAILABLE_BEFORE_SEND'].includes(a.error_code as string)
        &&BigInt(a.started_epoch_ms as string)>=BigInt((off as Record<string,unknown>).started_physical_epoch_ms as string)&&BigInt(a.started_epoch_ms as string)<=BigInt((on as Record<string,unknown>).physical_epoch_ms as string));
    }
    default:return false;
  }
}

export function deriveG2DeliveryEvidence(input: unknown,manifest: G2Manifest,{root=G2_ROOT}={}){
  const proof=input as DeliveryProofInput;
  if(proof?.schema_version!==1||proof.kind!=='G2_DELIVERY_PROOF'||manifest.mode!=='live'
    ||proof.run_id!==manifest.run_id||proof.candidate_fingerprint!==manifest.candidate_fingerprint
    ||![...G2_CLIENT_SCENARIOS,'G2-I01'].includes(proof.scenario_id as string)||!Array.isArray(proof.delivery_ref_hashes)
    ||proof.delivery_ref_hashes.length<1||proof.delivery_ref_hashes.length>160
    ||new Set(proof.delivery_ref_hashes).size!==proof.delivery_ref_hashes.length)failG2('DELIVERY_PROOF_INVALID');
  const read=(ref: SourceInput)=>readG2SourceJson(ref.ref,{root,sha256:ref.sha256 as string}) as SnapshotInput;
  const snapshot=read(proof.snapshot),startup=read(proof.startup);
  for(const p of [snapshot,startup])if(!g2SourceMatches(p,manifest))failG2('RUN_BINDING_INVALID');
  if(snapshot.kind!=='G2_RECONCILIATION_PACKET'||snapshot.query_sha256!==G2_RECONCILIATION_QUERY_HASH
    ||snapshot.database_identity_hash!==manifest.scope.database_identity_hash||g2StartupFacts(startup,manifest).start.result!=='PASS'
    ||snapshot.counts.unknown_pending!==0||snapshot.counts.out_of_scope_deliveries!==0)failG2('DELIVERY_RECONCILIATION_REQUIRED');
  if(!Array.isArray(proof.receipts)||proof.receipts.length<1||proof.receipts.length>2)failG2('DELIVERY_PROOF_INVALID');
  const receipts=(proof.receipts as SourceInput[]).flatMap((ref): (ProviderReceiptRow|WebhookReceiptRow)[]=>{
    readG2SourceFile(ref.ref,{root,sha256:ref.sha256 as string,maxBytes:2*1024*1024});
    const file=path.join(root,ref.ref as string);
    if((ref.ref as string).endsWith('/provider-receipts.jsonl'))return readG2ProviderReceipts({file,manifest});
    if((ref.ref as string).endsWith('/webhook-receipts.jsonl'))return readG2WebhookReceipts({file,manifest});
    failG2('DELIVERY_PROOF_INVALID');
  });
  const selected=(proof.delivery_ref_hashes as unknown[]).map(hash=>{
    const delivery=snapshot.deliveries.find(d=>d.delivery_ref_hash===hash);
    if(!delivery||delivery.status!=='SENT'||delivery.side_effect_state!=='ACKNOWLEDGED'
      ||delivery.visibility!=='EXTERNAL'||delivery.purpose==='INTERNAL_NOTE')failG2('DELIVERY_RECONCILIATION_REQUIRED');
    const receipt=receipts.map(r=>r.record).find(r=>r.delivery_ref_hash===hash&&r.outbox_id===delivery.outbox_id
      &&r.transport===delivery.transport&&r.provider_errcode===0&&r.outcome==='ACKED'
      &&snapshot.attempts.some(a=>a.delivery_ref_hash===hash&&a.attempt_no===r.attempt_no&&a.outcome==='SENT'&&a.side_effect_state==='ACKNOWLEDGED'));
    if(!receipt||BigInt(receipt.physical_epoch_ms as string)<BigInt(manifest.approval.valid_from_epoch_ms)
      ||BigInt(receipt.physical_epoch_ms as string)>=BigInt(manifest.approval.expires_epoch_ms)
      ||BigInt(receipt.physical_epoch_ms as string)>BigInt(snapshot.physical_epoch_ms as string))failG2('PROVIDER_ACK_NOT_VERIFIED');
    if(!scenarioMatches({proof,manifest,snapshot,delivery,receipt,root}))failG2('LIVE_SCENARIO_SOURCE_NOT_VERIFIED');
    return {delivery,receipt};
  });
  if(proof.scenario_id==='G2-E04'&&!selected.some(s=>s.delivery.entry_mode==='DIRECT_ORGANIC'&&s.delivery.organic_without_prior_group))failG2('DIRECT_ORGANIC_NOT_VERIFIED');
  const modes=[...new Set(selected.map(s=>s.delivery.entry_mode).filter(Boolean))];
  const stamp=selected.map(s=>BigInt(s.receipt.physical_epoch_ms as string)).reduce((a,b)=>a>b?a:b);
  return {scenario_id:proof.scenario_id,evidence_type:'LIVE_WECOM_RECEIPT',physical_epoch_ms:String(stamp),result:'PASS',
    details:{executed:true,provider_ack_numeric:true,sent_count:selected.length,reconciled:true,unknown_pending:0,seeded_business_facts:false,
      ...(modes.length===1?{entry_mode:modes[0]}:{}),assertions:[{code:'SCENARIO_SOURCE_BINDING_VERIFIED',passed:true}]}};
}
export function verifyG2DeliverySource(source: G2EvidenceSource,record: G2EvidenceRecord,manifest: G2Manifest,{root=G2_ROOT}={}){
  if(source.kind!=='DB_QUERY'||! /\/delivery-proof-[a-z0-9-]+\.json$/u.test(source.ref))return false;
  const proof=readG2SourceJson(source.ref,{root,sha256:source.sha256 as string}),expected=deriveG2DeliveryEvidence(proof,manifest,{root});
  return record.producer==='AUTOMATED'&&record.evidence_type===expected.evidence_type&&record.scenario_id===expected.scenario_id
    &&record.physical_epoch_ms===expected.physical_epoch_ms&&record.result===expected.result&&isDeepStrictEqual(record.details,expected.details);
}
