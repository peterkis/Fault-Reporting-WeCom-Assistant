import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT43Fixture,text,version} from './helpers/t43-full-service-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {start,launch,close,get,post} from './helpers/t43-service-actions.mjs';
import type {Browser} from './helpers/t43-service-actions.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';

// Card 34B: the detail drawer follows artboard 02. The take-over and hand-over chain enriches 「处理记录」 rows instead of a card of
// its own, 撤销派工 shows nothing when there is nothing to do, the composer has no avatar and keeps its draft state and 「清空」 as one
// small line at the left of its bottom bar, and blocks are separated by one hairline.
test('Card 34B detail drawer: chain in the timeline, no empty unassign block, composer draft line, single hairlines',{timeout:600000},()=>withT43Fixture(async f=>{
 const directory=process.env.CARD34_EVIDENCE_DIR??join(tmpdir(),'card34b-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
 const ticket=await start(f,await f.manualReport('卡34B 合成：打印机无法打印（合成）')),id=text(ticket.id),admin=f.staff[0],target=f.principals[1];assert.ok(admin&&target);
 // One real hand-over to a colleague, so the timeline has a take-over row and a hand-over row.
 const handed=await post(admin,'/api/tickets/'+id+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version((await get(admin,'/api/tickets/'+id)).version),reason_code:'CARD34B_SYNTHETIC',target_principal_id:target,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
 assert.ok(handed);await f.project();
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launch(f,'/workbench/app/');const b=browser;
  await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const shot=async(name:string)=>{await waitForAnimationsSettled(b);const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name),bytes);screenshots.push({file:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id});
  await b.waitFor("Boolean(document.querySelector('#detail-title'))&&document.querySelectorAll('.activity-list [data-assignment-history-row]').length===2");await waitForAnimationsSettled(b);
  const rows=text(await b.evaluate("[...document.querySelectorAll('.activity-list [data-assignment-history-row]')].map(row=>row.dataset.assignmentHistoryRow+'|'+row.innerText.replace(/\\s+/g,' ')).join('\\n')"));
  assert.match(rows,/^FIRST_RESPONSIBILITY\|.* 接单/mu,'the take-over is a timeline row 「… 接单」');
  assert.match(rows,/^RESPONSIBILITY_CHANGE\|.* 转交给 \S/mu,'the hand-over is a timeline row 「… 转交给 …」');
  assert.equal(await b.evaluate("Boolean(document.querySelector('[aria-label=\"接单与交接链\"]'))"),false,'no separate chain card');
  const page=text(await b.evaluate('document.body.innerText'));
  for(const gone of ['最多保留 200 条','仅为当前已读取范围','重新读取接单链','当前没有可提交的撤派动作','当前没有可提交的退回动作'])assert.ok(!page.includes(gone),'no 「'+gone+'」');
  assert.equal(await b.evaluate("[...document.querySelectorAll('.ticket-unassign,.ticket-return-to-dispatch')].some(node=>node.checkVisibility())"),false,'no unassign or return block without an action');
  // One hairline between blocks: the workflow container draws none, and every shown block draws at most one.
  assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-step-controllers .detail-workflows')].every(node=>getComputedStyle(node).borderBottomWidth==='0px')"),true,'the workflow container draws no line of its own');
  assert.equal(await b.evaluate("Boolean(document.querySelector('.ds-note-composer-row>.ds-avatar'))"),false,'the composer has no avatar');
  await shot('drawer-1440-processing.png');
  // A saved draft: 「✓ 草稿已保存 · 清空」 at the left of the composer's bottom bar, in small tertiary text.
  await clickWorkbenchControl(b,'.ds-detail-footer textarea');await b.command('Input.insertText',{text:'卡34B 合成草稿（合成）'});
  await b.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");await waitForAnimationsSettled(b);
  const draft=await b.evaluate(`(()=>{const line=document.querySelector('.ds-note-bottom .ds-note-draft'),s=getComputedStyle(line),fs=getComputedStyle(document.documentElement);
   const visible=line.cloneNode(true);visible.querySelectorAll('.sr-only').forEach(node=>node.remove());
   return {text:visible.textContent.replace(/\\s+/g,''),icon:Boolean(line.querySelector('[data-draft-status] svg')),clear:line.querySelector('[data-action=discard-note-draft]')?.textContent.trim()??null,
    size:s.fontSize===fs.getPropertyValue('--fs-xs').trim(),colour:s.color,tertiary:(()=>{const probe=document.createElement('span');probe.style.color='var(--text-tertiary)';document.body.append(probe);const c=getComputedStyle(probe).color;probe.remove();return c;})(),
    left:line.getBoundingClientRect().left<=document.querySelector('.ds-note-bottom').getBoundingClientRect().left+1,separate:Boolean(document.querySelector('.note-controls [data-action=discard-note-draft]'))};})()`) as {text:string;icon:boolean;clear:string|null;size:boolean;colour:string;tertiary:string;left:boolean;separate:boolean};
  assert.equal(draft.text,'草稿已保存·清空','the draft line reads 「草稿已保存 · 清空」 '+JSON.stringify(draft));
  assert.ok(draft.icon&&draft.clear==='清空'&&draft.size&&draft.colour===draft.tertiary&&draft.left&&!draft.separate,'check icon, text button, --fs-xs, --text-tertiary, left of the bar, no separate discard button '+JSON.stringify(draft));
  await shot('drawer-1440-composer-draft.png');
  // Codex review: the action follows the event type. A dispatcher's first assignment is 「派给 …」 (not the dispatcher's own 接单),
  // the assignee accepting is 「接单」, and stopping work already started is 「退回待安排」 (not 撤销派工).
  const handler=f.staff[1];assert.ok(handler);
  // Codex review (second round): names never prove identity. The handler is renamed to the dispatcher's display name; the
  // dispatcher's assignment must still read as assigning someone else, not as their own 接单.
  assert.equal((await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'t43-staff-1',displayName:'T43合成人员0',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']})).id,target);
  const second=await f.intake((await f.manualReport('卡34B 合成：派工与退回（合成）')).intakeId);assert.ok(second.ticketId);
  const path2='/api/tickets/'+second.ticketId,current2=async()=>version((await get(admin,path2)).version);
  await post(admin,path2+'/assign',{client_command_id:randomUUID(),expected_version:await current2(),reason_code:'WORKBENCH_ASSIGN',target_principal_id:target,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
  await post(handler,path2+'/accept',{client_command_id:randomUUID(),expected_version:await current2(),reason_code:'CARD34B_HANDLER_ACCEPT'});
  await post(handler,path2+'/start',{client_command_id:randomUUID(),expected_version:await current2(),reason_code:'CARD34B_STARTED'});
  await post(handler,path2+'/return-to-dispatch',{client_command_id:randomUUID(),expected_version:await current2(),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'需要重新安排具备条件的同事（合成）。',unfinished_work:'设备仍不可用（合成）。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
  await f.project();
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+second.ticketId});
  await b.waitFor("Boolean(document.querySelector('#detail-title'))&&document.querySelectorAll('.activity-list [data-assignment-history-row]').length===3");await waitForAnimationsSettled(b);
  const chain=text(await b.evaluate("[...document.querySelectorAll('.activity-list [data-assignment-history-row]')].reverse().map(row=>row.dataset.assignmentHistoryRow+'|'+row.innerText.replace(/\\s+/g,' ')).join('\\n')"));
  const [assigned,accepted,returned]=chain.split('\n');
  assert.match(assigned??'',/^FIRST_RESPONSIBILITY\|.* 派给 T43合成人员0/u,'a dispatcher\'s first assignment reads 「派给 …」 '+chain);
  assert.doesNotMatch(assigned??'',/ 接单/u,'the dispatcher did not accept the ticket '+chain);
  assert.match(accepted??'',/^RESPONSIBILITY_CHANGE\|.* 接单/u,'the assignee accepting reads 「接单」 '+chain);
  assert.match(returned??'',/^RESPONSIBILITY_CHANGE\|.* 退回待安排/u,'returning started work reads 「退回待安排」 '+chain);
  assert.doesNotMatch(chain,/撤销派工/u,'no return reads as 撤销派工 '+chain);
 }catch(caught){error=caught;}
 finally{
  await writeFile(join(directory,'receipt-34b-detail.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,screenshots},null,2));
  await close(browser,error);
 }
}));
