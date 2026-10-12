import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {record,text} from './wbint-t27-browser-fixture.mjs';
import type {Browser,Context} from './wbint-t27-browser-fixture.mjs';

// SOURCE_ONLY / NOT_BUILT_NOT_RUN: existing authenticated HTTP and compiled UI seams.
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}
export async function followupHttp(browser:Browser){
  const read=async(path:string)=>record(await browser.evaluate(`fetch(${JSON.stringify(path)},{credentials:'same-origin',cache:'no-store'}).then(async r=>({status:r.status,body:await r.json()}))`));
  const get=async(path:string)=>{const response=await read(path);assert.equal(response.status,200,JSON.stringify(response.body));return record(response.body);};
  const post=async(path:string,body:Record<string,unknown>,expectedStatus:number|null=200)=>{
    const csrf=text((await get('/api/lifecycle/bootstrap')).csrf_token),version=body.expected_candidate_version??body.expected_row_version;
    const response=record(await browser.evaluate(`fetch(${JSON.stringify(path)},{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':${JSON.stringify(csrf)},'idempotency-key':${JSON.stringify(body.client_command_id)},'if-match':${JSON.stringify('"'+String(version)+'"')}},body:${JSON.stringify(JSON.stringify(body))}}).then(async r=>({status:r.status,body:await r.json()}))`));
    assert.equal(typeof response.status,'number');const result={status:response.status as number,body:record(response.body)};
    if(expectedStatus!==null)assert.equal(result.status,expectedStatus,JSON.stringify(result.body));
    if(result.status===200)assert.equal(result.body.ok,true);
    return result;
  };
  return {browser,read,get,post};
}
export type FollowupHttp=Awaited<ReturnType<typeof followupHttp>>;
export async function confirmIncident(http:FollowupHttp,candidateId:string,ownerId:string,selectedRefs:readonly string[]){
  const path='/api/incident-candidates/'+candidateId,current=await http.get(path);
  await http.post(path+'/start-review',{client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:text(current.row_version)});
  const reviewed=await http.get(path),result=await http.post(path+'/confirm',{
    client_command_id:randomUUID(),reason_code:'CONFIRMED_SHARED_FAULT',expected_candidate_version:text(reviewed.row_version),expected_material_basis:text(reviewed.material_basis),
    confirmed_scope:'LOCAL',owner_principal_id:ownerId,owner_team_id:null,selected_report_refs:[...selectedRefs],primary_ticket_id:null,
  });
  assert.equal(result.body.result_ref_type,'INCIDENT');return text(result.body.result_ref_id);
}
export async function prepareFollowup(context:Context,selectedCount=context.f.reports.length){
  const http=await followupHttp(context.browser),id=await confirmIncident(http,context.candidateId,text(record(context.f.handler).id),context.f.reports.slice(0,selectedCount).map(report=>text(record(report).decisionId)));
  return {http,id,path:'/api/incidents/'+id};
}
export async function personalSnapshots(http:FollowupHttp,reports:readonly unknown[]){
  return Promise.all(reports.map(async value=>{const ticketId=text(record(value).ticketId),path='/api/tickets/'+ticketId;
    return {ticketId,detail:await http.get(path),events:await http.get(path+'/events?limit=200'),responsibility:await http.get(path+'/responsibility')};
  }));
}
export async function navigateFollowup(context:Context,id:string){
  await context.browser.command('Page.navigate',{url:context.origin+'/workbench/app/incidents/'+id});
  await context.browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${id}"]'))`);
}
export async function chooseFollowup(browser:Browser,label:string,value:string){
  const selector='select[aria-label="'+label+'"]';
  assert.equal(await browser.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});return Boolean(s&&[...s.options].some(o=>o.value===${JSON.stringify(value)}&&!o.disabled));})()`),true,'authorized follow-up choice: '+label+'/'+value);
  await browser.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});if(!s)throw Error('T28_FOLLOWUP_CONTROL_REQUIRED');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
export async function observeFollowupPosts(browser:Browser){
  await browser.evaluate(`(()=>{const send=globalThis.fetch;globalThis.__t28Posts=[];globalThis.fetch=async(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(options?.method==='POST'&&path.startsWith('/api/incidents/')){const h=new Headers(options.headers);globalThis.__t28Posts.push({path,body:options.body,if_match:h.get('if-match'),idempotency_key:h.get('idempotency-key')});}return send(input,options);};})()`);
}
export async function submitFollowup(context:Context,id:string,action:string,reason:string,controls:ReadonlyArray<readonly[string,string]>,expectedVersion:string){
  await chooseFollowup(context.browser,'公共故障操作',action);
  await chooseFollowup(context.browser,'决定原因',reason);
  for(const [label,value] of controls)await chooseFollowup(context.browser,label,value);
  await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');
  await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');
  await context.browser.waitFor(`(()=>{const r=document.querySelector('[data-incident-id="${id}"]'),dt=[...(r?.querySelectorAll('dt')??[])].find(x=>x.textContent==='公共故障版本');return dt?.nextElementSibling?.textContent===${JSON.stringify(expectedVersion)};})()`);
}
export async function assertClosedUiCommand(browser:Browser,path:string,expected:Record<string,unknown>){
  const posts=rows(await browser.evaluate('globalThis.__t28Posts')).filter(item=>item.path===path);assert.equal(posts.length,1);
  const post=posts[0];assert.ok(post);const command=record(JSON.parse(text(post.body)));
  assert.match(text(command.client_command_id),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.equal(post.idempotency_key,command.client_command_id);assert.equal(post.if_match,'"'+text(command.expected_row_version)+'"');
  const {client_command_id:_id,...intent}=command;assert.deepEqual(intent,expected);
  return command;
}
