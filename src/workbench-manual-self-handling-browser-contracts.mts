import type {ManualReportSelfHandlingCommand,ManualReportSelfHandlingContext,ManualReportSelfHandlingResult} from '../contracts/workbench_manual_report_self_handling_contracts.js';
import {decodeManualReportCommand,decodeManualReportDraft,decodeManualReportInput,decodeManualReportResult,manualReportCommandFromInput,ManualReportContractError} from './workbench-manual-report-browser-contracts.mjs';
import type {ManualReportInput} from './workbench-manual-report-browser-contracts.mjs';
export type {ManualReportSelfHandlingCommand,ManualReportSelfHandlingContext,ManualReportSelfHandlingResult};
export const MANUAL_SELF_HANDLING_PURPOSE='manual-report-self-handling';
function invalid():never{throw new ManualReportContractError('MANUAL_SELF_HANDLING_CONTRACT_INVALID');}
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))invalid();return value as Record<string,unknown>;}
function team(value:unknown,blank=false):string{if(typeof value!=='string'||!(blank&&value===''||/^[A-Z][A-Z0-9_]{0,63}$/u.test(value)))invalid();return value;}
export function decodeManualSelfHandlingCommand(input:unknown):ManualReportSelfHandlingCommand{
  const value=exact(input,['schema_version','client_command_id','source','description','location','reporter','resolver_team_id']),{resolver_team_id,...base}=value;
  const command=decodeManualReportCommand(base);if(command.reporter.verification!=='UNVERIFIED')invalid();
  return {...command,reporter:command.reporter,resolver_team_id:team(resolver_team_id)};
}
export function manualSelfHandlingCommand(value:ManualReportInput,id:string,resolverTeamId:string):ManualReportSelfHandlingCommand{
  return decodeManualSelfHandlingCommand({...manualReportCommandFromInput(value,id),resolver_team_id:resolverTeamId});
}
export function decodeManualSelfHandlingContext(input:unknown):ManualReportSelfHandlingContext{
  const value=exact(input,['can_take_and_start','resolver_teams','manual_contact_required','external_notification','draft_recovery_enabled']);
  if(typeof value.can_take_and_start!=='boolean'||value.manual_contact_required!==true||value.external_notification!==false||typeof value.draft_recovery_enabled!=='boolean'||!Array.isArray(value.resolver_teams)||value.resolver_teams.length>100)invalid();
  const teams=value.resolver_teams.map(input=>{const row=exact(input,['id','name']);if(typeof row.name!=='string'||[...row.name].length<1||[...row.name].length>100)invalid();return {id:team(row.id),name:row.name};});
  if(new Set(teams.map(t=>t.id)).size!==teams.length||value.can_take_and_start!==(teams.length>0))invalid();
  return {can_take_and_start:value.can_take_and_start,resolver_teams:teams,manual_contact_required:true,external_notification:false,draft_recovery_enabled:value.draft_recovery_enabled};
}
export function decodeManualSelfHandlingResult(input:unknown,id:string):ManualReportSelfHandlingResult{
  const result=decodeManualReportResult(input,id);
  if(result.reporter_verification!=='UNVERIFIED'||result.result_code!=='TICKET_ELIGIBLE'&&result.result_code!=='SERVICE_REQUEST'||result.review!==null||result.ticket?.status!=='IN_PROGRESS')invalid();
  return {...result,result_code:result.result_code,reporter_verification:'UNVERIFIED',manual_contact_required:true,ticket:{...result.ticket,status:'IN_PROGRESS'},review:null};
}
export interface ManualSelfHandlingCopy {value:ManualReportInput;team:string;pending:ManualReportSelfHandlingCommand|null}
export function encodeManualSelfHandlingDraft(copy:ManualSelfHandlingCopy):string{
  return JSON.stringify(copy.pending?{schema:1,pending:copy.pending}:{schema:1,value:copy.value,team:copy.team});
}
export function decodeManualSelfHandlingDraft(text:string):ManualSelfHandlingCopy{
  const value:unknown=JSON.parse(text);
  if(value&&typeof value==='object'&&'pending' in value){const root=exact(value,['schema','pending']);if(root.schema!==1)invalid();const pending=decodeManualSelfHandlingCommand(root.pending),{resolver_team_id,...base}=pending;
    return {value:decodeManualReportDraft(JSON.stringify({schema:1,pending:base})).value,team:resolver_team_id,pending};}
  const root=exact(value,['schema','value','team']);if(root.schema!==1)invalid();return {value:decodeManualReportInput(root.value),team:team(root.team,true),pending:null};
}
