import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {expandPendingBoard,query,ticketCard} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {
  type Browser, type Scene, options, withScene, claimPath, claim, routeWrite, startTrace, conflict,
  closeUndo, followUndo, screenshot, openDetail, fillClose, ctrlZ, toast, heading, claimToast, undo,
  confirmClose, visible, active, pending, counts, indexOf, badge,
} from './helpers/card37a-optimistic-fixture.mjs';

const twoFrames='new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))';

test('37A A5.1 instant column and counts; delayed badge never flashes on an 80ms response',options,async t=>{
  for(const delay of [2000,80])await t.test(delay+'ms',()=>withScene(async({b,card})=>{
    const before=await b.evaluate(counts) as [number,number];
    await routeWrite(b,claimPath,delay);
    await startTrace(b,card);
    await claim(b,card);
    await b.waitFor('card37Trace.moved!==null');
    const {ms,after}=await b.evaluate('({ms:card37Trace.moved-card37Trace.clicked,after:card37Trace.counts})') as {ms:number;after:number[]};
    assert.ok(ms>=0&&ms<=100,'click to committed column: '+ms+'ms');
    assert.deepEqual(after,[before[0]-1,before[1]+1]);
    if(delay===2000){
      await b.waitFor(visible(badge(active(card))));
      assert.equal(await b.evaluate(query(badge(card))+'.textContent.trim()'),'确认中');
      assert.equal(await b.evaluate('card37Route.ack'),0);
    }
    await b.waitFor(heading('ticket-self-handling')+'==="已领取"');
    await b.evaluate(twoFrames);
    assert.equal(await b.evaluate('card37Trace.stop();card37Trace.badge'),delay===2000);
    assert.equal(await b.evaluate('card37Route.status'),200);
    if(delay===80)assert.ok(await b.evaluate('card37Route.ack-card37Route.started<150'),'fast route really completed before badge threshold');
  }));
});

test('37A A5.2 confirmation does not replay the optimistic card movement',options,()=>withScene(async({b,card})=>{
  await startTrace(b,card);
  await routeWrite(b,claimPath,'hold');
  await claim(b,card);
  await b.waitFor('card37Trace.moveTimes.length>0');
  await waitForAnimationsSettled(b);
  await b.evaluate('card37Route.release()');
  await b.waitFor(heading('ticket-self-handling')+'==="已领取"');
  await b.waitFor(query(active(card))+'&&!'+query(card+'[data-optimistic-state]'));
  await waitForAnimationsSettled(b);
  assert.deepEqual(await b.evaluate('card37Trace.stop();card37Trace.moveTimes.filter(t=>t>=card37Route.ack)'),[]);
}));

test('37A A5.3 concurrent claimant, original index, empty overlay and danger outline',options,()=>withScene(s=>conflict(s)));

async function releaseClashAndReadFlashes(b:Browser){
  await b.evaluate(`(()=>{
    const fetch=window.fetch;
    window.flashesAtReread=null;
    window.fetch=(input,init)=>{
      if(card37Route.status===409&&new URL(input instanceof Request?input.url:input,location.href).pathname==='/api/workbench/board'){
        window.flashesAtReread??=card37Trace.flashStarts.map(f=>({column:f.start?.dom,reminder:f.reminder,finished:f.finished}));
      }
      return fetch(input,init);
    };
    card37Route.release();
  })()`);
  await b.waitFor('flashesAtReread!==null');
  assert.equal(await b.evaluate('card37Route.status'),409);
  return b.evaluate('flashesAtReread');
}

test('37A A5.3 normal board waits for a visible rollback and skips a collapsed subgroup',options,async t=>{
  for(const collapsed of [false,true])await t.test(collapsed?'collapsed 待接单':'expanded 待接单',()=>withScene(async({b,f,id,card})=>{
    const group='.board-column.pending [data-board-group="待接单"] .ds-board-group-trigger';
    assert.equal(await b.evaluate(query('.reminder-location')),null);
    await routeWrite(b,claimPath,'hold');
    await startTrace(b,card,true);
    try{
      await claim(b,'.board '+card);
      await b.waitFor(visible(active(card))+'&&card37Route.started>0');
      if(collapsed){
        await clickWorkbenchControl(b,group);
        await b.waitFor(query(group)+'.getAttribute("aria-expanded")==="false"');
      }
      await waitForAnimationsSettled(b,'.board');
      await (await t11Http(f,2,{closeConnections:true})).start(id);
      assert.deepEqual(await releaseClashAndReadFlashes(b),collapsed?[]:[{column:'pending',reminder:false,finished:true}]);
      await b.waitFor(query(active(card)+' .owner-name')+'?.textContent==="陈悦（合成）"');
      assert.equal(await b.evaluate('card37Trace.flashStarts.length'),collapsed?0:1);
    }finally{await b.evaluate('card37Trace.stop()');}
  }));
});

test('37A A5.3 claim from the sole reminder card finishes one outline before the board reread',options,()=>withScene(async({b,f,id,card})=>{
  const reminder='.reminder-location '+card;
  // Observe both sides of the real locate GET, independently of the board GETs.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    if(new URLSearchParams(location.search).get('locate')!=='1')return;
    const fetch=window.fetch;
    window.fetch=async(input,init)=>{
      if(new URL(input instanceof Request?input.url:input,location.href).pathname===${JSON.stringify('/api/workbench/items/ticket/'+id)}){
        window.fetch=fetch;
        await new Promise(resolve=>{window.releaseLocateRead=resolve;});
      }
      return fetch(input,init);
    };
  })()`});
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id+'?range=all&locate=1'});
  await b.waitFor('typeof window.releaseLocateRead==="function"');
  try{
    await expandPendingBoard(b);
    await b.waitFor(visible(pending(card)));
    assert.equal(await b.evaluate(query(reminder)),null);
  }finally{await b.evaluate('releaseLocateRead()');}
  await b.waitFor(visible(reminder));
  assert.equal(await b.evaluate(query('.board '+card)),null);
  await routeWrite(b,claimPath,'hold');
  await startTrace(b,card,true);
  try{
    await claim(b,reminder);
    await b.waitFor('card37Route.started>0&&'+visible(reminder+'[data-optimistic-pending=claim]'));
    await (await t11Http(f,2,{closeConnections:true})).start(id);
    assert.deepEqual(await releaseClashAndReadFlashes(b),[{column:null,reminder:true,finished:true}]);
    assert.equal(await b.evaluate('card37Trace.flashStarts[0].firstFrame!==null'),true);
    assert.equal(await b.evaluate(visible(reminder)),true);
    assert.equal(await b.evaluate(query('.board '+card)),null);
    await b.waitFor(visible(claimToast+' [data-toast-action=view]'));
    assert.ok(String(await b.evaluate(query(claimToast)+'.innerText')).includes('陈悦（合成）'));
    await clickWorkbenchControl(b,'.reminder-location .column-heading a');
    await b.waitFor(query('.reminder-location')+'===null');
    await b.evaluate("document.querySelector('.board-column.active [data-action=expand-column][aria-expanded=false]')?.click()");
    await b.waitFor(query(active(card)+' .owner-name')+'?.textContent==="陈悦（合成）"');
    assert.equal(await b.evaluate('card37Trace.flashStarts.length'),1);
  }finally{await b.evaluate('card37Trace.stop()');}
},{remindersEnabled:true}));

test('37A A5.3 rejected second claim restores the Undo index after a delayed board read',options,()=>withScene(async({b,card})=>{
  const index=await b.evaluate(indexOf(card));assert.ok(Number(index)>0);
  await claim(b,card);
  const undoClaim=claimToast+' [data-toast-action=undo]';
  await b.waitFor(visible(undoClaim)+'&&'+visible(active(card))+'&&!'+query(card+'[data-optimistic-state]'));
  await b.evaluate(`(()=>{
    const fetch=window.fetch,gate=new Promise(resolve=>{window.resumeUndoBoard=resolve});
    window.undoBoardReads=0;
    window.fetch=async(input,init)=>{
      if(new URL(input instanceof Request?input.url:input,location.href).pathname==='/api/workbench/board'){
        window.undoBoardReads++;
        await gate;
      }
      return fetch(input,init);
    };
  })()`);
  try{
    await clickWorkbenchControl(b,undoClaim);
    await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"&&undoBoardReads>0');
    assert.equal(await b.evaluate(indexOf(card)),index);
    await routeWrite(b,claimPath,'reject');
    await claim(b,card);
    await b.waitFor(visible(active(card))+'&&card37Route.started>0');
    await b.evaluate('card37Route.release()');
    await b.waitFor(visible(claimToast+' [data-toast-action=view]'));
    assert.equal(await b.evaluate('card37Route.status'),409);
  }finally{await b.evaluate('resumeUndoBoard()');}
  await b.waitFor(visible(pending(card))+'&&!'+query(card+'[data-optimistic-state]'));
  await waitForAnimationsSettled(b,'.board');
  assert.equal(await b.evaluate(indexOf(card)),index);
}));

test('37A A5.3 direct conversation claim waits for the returned card outline before rereading the board',options,()=>withScene(async s=>{
  const {b,card,id,f}=s,action='take-and-start-with-conversations';
  const originalIndex=await b.evaluate(indexOf(card));
  await openDetail(s);
  await routeWrite(b,'/'+action,'hold');
  await startTrace(b,card,true);
  try{
    await clickWorkbenchControl(b,'.detail-dialog [data-action='+action+']');
    await b.waitFor('card37Route.started>0&&'+visible(active(card)));
    await waitForAnimationsSettled(b,'.board');
    const peer=await t11Http(f,2,{closeConnections:true}),current=await peer.detail(id);
    const won=await peer.post(id,action,{client_command_id:randomUUID(),expected_version:current.version,
      reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:current.resolver_team_id,communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(won.status,200,await won.text());
    // Observe the first real reread at dispatch. A later successful fetch cannot mask an early one.
    await b.evaluate(`(()=>{
      const fetch=window.fetch;
      window.firstBoardReadAfterOutline=null;
      window.fetch=(input,init)=>{
        if(card37Route.status===409&&new URL(input instanceof Request?input.url:input,location.href).pathname==='/api/workbench/board'){
          window.firstBoardReadAfterOutline??=card37Trace.flashStarts.some(f=>f.finished&&f.firstFrame?.visual==='pending'&&f.firstFrame.index===${originalIndex});
        }
        return fetch(input,init);
      };
      card37Route.release();
    })()`);
    await b.waitFor('firstBoardReadAfterOutline!==null');
    assert.equal(await b.evaluate('firstBoardReadAfterOutline'),true,'the outline finished at the original index before the first board GET');
    await b.waitFor(visible(toast('ticket-conversation-handling')+' [data-toast-action=view]'));
    await b.waitFor(query(active(card)+' .owner-name')+'?.textContent==="陈悦（合成）"');
  }finally{await b.evaluate('card37Trace.stop()');}
},{conversationClaim:true}));

test('37A A5.3 a one-click clash leaves the board interactive and a move-form clash retains its original intent',options,async t=>{
  const bar='[data-board-original-intent]';
  await t.test('one-click claim',()=>withScene(async({b,f,id,card})=>{
    const filter='.ds-summary-card[data-summary-filter=overdue]';
    const menu=card+' [data-action=board-action-menu]';
    const index=await b.evaluate(indexOf(card));
    await routeWrite(b,claimPath,'hold');
    await startTrace(b,card,true);
    try{
      await claim(b,card);
      await b.waitFor(visible(active(card))+'&&card37Route.started>0');
      await waitForAnimationsSettled(b,'.board');
      const peer=await t11Http(f,2,{closeConnections:true});
      await peer.start(id);
      await b.evaluate('card37Route.release()');
      await b.waitFor(visible(claimToast+' [data-toast-action=view]'));
      assert.equal(await b.evaluate('card37Route.status'),409);
      assert.equal(await b.evaluate(heading('ticket-self-handling')),'没有领取成功');
      assert.ok(String(await b.evaluate(query(claimToast)+'.innerText')).includes('陈悦（合成）刚刚已经领取了这张工单'));
      assert.equal(await b.evaluate(query(claimToast+' [data-toast-action=view]')+'.textContent.trim()'),'查看');
      assert.equal(await b.evaluate(query(bar)),null);
      assert.equal(await b.evaluate(query('.board-claim-controller [data-action=refresh-self-handling]')),null);
      assert.equal(await b.evaluate(query('.nav-item[title="工作台"]')+'.getAttribute("aria-disabled")'),'false');
      assert.equal(await b.evaluate(query(menu)+'.matches(":disabled,[aria-disabled=true],[data-disabled=true]")'),false);
      assert.equal(await b.evaluate(query(card+' [data-action=board-drag-handle]')+'.getAttribute("aria-disabled")'),'false');
      // Board reads run normally. The red ring must appear at the old index before the winner's projection replaces it.
      await b.waitFor('card37Trace.flashStarts.some(f=>f.firstFrame?.visual==="pending"&&f.firstFrame.index==='+index+')');
      await b.waitFor(query(active(card)+' .owner-name')+'?.textContent==="陈悦（合成）"');
      await waitForAnimationsSettled(b,'.board');
      assert.equal(await b.evaluate('card37Trace.flashStarts.some(f=>f.start?.visual==="active"||f.inActive!==null)'),false);
      assert.equal(await b.evaluate(query(bar)),null);
      assert.equal(await b.evaluate(query(filter)+'.matches(":disabled,[aria-disabled=true],[data-disabled=true]")'),false);
      await clickWorkbenchControl(b,filter);
      await b.waitFor(query(filter)+'.getAttribute("aria-pressed")==="true"');
    }finally{await b.evaluate('card37Trace.stop()');}
  }));
  await t.test('pending-to-active move form',()=>withScene(async({b,http,id,card})=>{
    const panel='.detail-dialog '+bar;
    await routeWrite(b,claimPath,'hold');
    await b.evaluate(query(card+' .card-open')+'.focus({preventScroll:true})');
    await clickWorkbenchControl(b,card+' [data-action=board-action-menu]');
    await clickWorkbenchControl(b,card+' [data-board-action-target=active]');
    await b.waitFor(visible('.detail-dialog [data-board-intent-panel]'));
    await clickWorkbenchControl(b,'.detail-dialog [data-action=take-and-start]');
    await b.waitFor('card37Route.started>0');
    const current=await http.detail(id);
    const accepted=await http.post(id,'accept-for-later',{client_command_id:randomUUID(),expected_version:current.version,
      reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:current.resolver_team_id});
    assert.equal(accepted.status,200,await accepted.text());
    await b.evaluate('card37Route.release()');
    await b.waitFor(visible(panel));
    assert.equal(await b.evaluate('card37Route.status'),409);
    assert.equal(await b.evaluate(query(panel+' .ds-inline-alert')+'.textContent'),'原操作冲突，完整原意图保留。未自动发送，也未按拖动目标移动事项。');
    assert.equal(await b.evaluate(query(panel+' [data-action=adopt-current-board-facts]')+'.textContent.trim()'),'明确读取当前事实，保留填写内容并开始新意图');
    assert.deepEqual(await b.evaluate('JSON.parse('+query(panel+' [data-diagnostics]')+'.dataset.diagnostics)'),
      await b.evaluate('({operation_id:card37Route.body.client_command_id,expected_version:card37Route.body.expected_version,action:"take-and-start"})'));
  }));
});

test('37A A5.4 an eight-second hang hands off to result checking without Undo',options,()=>withScene(async({b,card})=>{
  await routeWrite(b,claimPath,'hang');await startTrace(b,card);await claim(b,card);
  await b.waitFor(visible(active(card)+'[data-optimistic-pending=claim]'));
  const check='[data-action=check-self-handling]';
  await b.waitFor(visible(check)+'&&card37Trace.unknownAt!==null',{timeoutMs:10000});
  assert.match(String(await b.evaluate('document.body.innerText')),/结果未确认/u);
  assert.ok(await b.evaluate('card37Trace.unknownAt-card37Trace.clicked>=8000&&card37Trace.unknownAt-card37Trace.clicked<8500'));
  assert.equal(await b.evaluate('document.querySelectorAll("[data-toast-action=undo]").length'),0);
  // The hung request never committed. Explicit replay reaches a terminal result.
  await clickWorkbenchControl(b,check);
  await b.waitFor(visible(active(card))+ '&&!'+query(card+'[data-optimistic-state]'),{timeoutMs:5000});
}));

async function claimUndo(s:Scene){
  const {b,id,card,http,f}=s;
  const index=await b.evaluate(indexOf(card));
  assert.ok(Number(index)>0,'a non-leading position detects an incorrect return to the top');
  await claim(b,card);
  const button=claimToast+' [data-toast-action=undo]';
  await b.waitFor(visible(button));
  assert.equal(await b.evaluate(heading('ticket-self-handling')),'已领取');
  await screenshot(b,'undo-claim-toast',visible(active(card))+'&&'+visible(button),claimToast);
  await routeWrite(b,'/return-to-dispatch','hold');
  await clickWorkbenchControl(b,button);
  await b.waitFor(visible(pending(card))+'&&card37Route.started>0');
  assert.equal(await b.evaluate(indexOf(card)),index);
  assert.equal((await http.detail(id)).status,'IN_PROGRESS');
  const body=await b.evaluate('card37Route.body') as Record<string,unknown>;
  assert.equal(body.reason,'撤销领取');assert.equal(body.unfinished_work,'刚领取即撤销，尚未开始处理');
  assert.equal(body.communication_choice,'RETAIN_CURRENT');
  await b.evaluate('card37Route.release()');
  await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"');
  await screenshot(b,'undo-done-toast',visible(pending(card))+'&&'+indexOf(card)+'==='+index+'&&'+
    heading('ticket-return-to-dispatch')+'==="已撤销"',toast('ticket-return-to-dispatch'));
  const state=await http.detail(id);assert.equal(state.status,'QUEUED');assert.equal(state.assignee_id,null);
  await b.waitFor(visible(pending(card))+'&&!'+query(card+'[data-optimistic-state]'));
  assert.equal(await b.evaluate(indexOf(card)),index);
  const events=await f.pool.query<{event_type:string;internal_note:string|null}>(`SELECT event_type,internal_note FROM pilot_ticket.ticket_event
    WHERE ticket_id=$1 AND event_type IN ('ticket.started','ticket.returned_to_dispatch') ORDER BY aggregate_version,event_ordinal`,[id]);
  assert.deepEqual(events.rows.map(row=>row.event_type),['ticket.started','ticket.returned_to_dispatch']);
  assert.match(events.rows[1]?.internal_note??'',/撤销领取/u);
}
test('37A A5.5 Undo executes the real inverse and honours return permission',options,async t=>{
  await t.test('claim and return with both history events',()=>withScene(claimUndo));
  await t.test('close and restore prior status and column',()=>withScene(s=>closeUndo(s,true)));
  await t.test('an older toast cannot restore a later closure',()=>withScene(async s=>{
    await fillClose(s);
    await clickWorkbenchControl(s.b,confirmClose);
    const button=toast('ticket-waiting-cancel')+' [data-toast-action=undo]';
    await s.b.waitFor(visible(button));
    // A separate HTTP client uses the normal restore and dismiss ports before the operator clicks.
    const other=await t11Http(s.f,0,{closeConnections:true});
    const first=await other.detail(s.id);
    const restore=await other.post(s.id,'restore',{client_command_id:randomUUID(),expected_version:first.version,reason_code:'RESTORE_CLOSED'});
    assert.equal(restore.status,200,await restore.text());
    const reopened=await other.detail(s.id);
    const second=await other.post(s.id,'dismiss',{client_command_id:randomUUID(),expected_version:reopened.version,
      reason_code:'REPORTER_WITHDREW',notify_reporter:true,note:'第二次关闭（合成）'});
    assert.equal(second.status,200,await second.text());
    const latest=await other.detail(s.id);
    await clickWorkbenchControl(s.b,button);
    await s.b.waitFor(visible(toast('closure-restore')));
    assert.match(String(await s.b.evaluate(heading('closure-restore'))),/没有撤销成功/u);
    const after=await other.detail(s.id);
    assert.equal(after.status,'DISMISSED');assert.equal(after.version,latest.version);
  }));
  await t.test('follow and undo',()=>withScene(followUndo));
  await t.test('return capability off',()=>withScene(async({b,card})=>{
    await claim(b,card);await b.waitFor(heading('ticket-self-handling')+'==="已领取"');
    assert.equal(await b.evaluate('document.querySelectorAll("[data-toast-action=undo]").length'),0);
  },{canReturn:false}));
});

test('37A A5.6 Windows Control+Z routes only the newest Undo and preserves native note editing',options,async t=>{
  await t.test('single toast',()=>withScene(async({b,card,http,id})=>{
    await claim(b,card);await b.waitFor(visible(undo));
    await ctrlZ(b);await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"');
    assert.equal((await http.detail(id)).assignee_id,null);
  }));
  await t.test('native text undo in the internal note',()=>withScene(async s=>{
    const {b,card,http,id}=s;
    await claim(b,card);await b.waitFor(visible(undo));
    await openDetail(s);
    const input='#internal-note';
    await clickWorkbenchControl(b,input);
    const before=await b.evaluate(query(input)+'.value');
    await b.command('Input.insertText',{text:'内部备注（合成）'});
    assert.notEqual(await b.evaluate(query(input)+'.value'),before);
    assert.equal(await b.evaluate(visible(undo)),true);
    await b.evaluate(`window.addEventListener('keydown',e=>{if(e.ctrlKey&&e.code==='KeyZ')window.noteUndoPrevented=e.defaultPrevented},{once:true})`);
    await ctrlZ(b,true);await b.waitFor(query(input)+'.value==='+JSON.stringify(before));
    assert.equal(await b.evaluate('window.noteUndoPrevented'),false);
    assert.equal(await b.evaluate(visible(undo)),true);
    assert.equal((await http.detail(id)).status,'IN_PROGRESS');
  }));
  await t.test('only the latest of two live toasts',()=>withScene(async({b,card,f,id,http})=>{
    const second=f.tickets[0]?.ticket.id;assert.ok(second);
    await claim(b,card);await b.waitFor(visible(undo));
    await claim(b,ticketCard(second));
    await b.waitFor('document.querySelectorAll('+JSON.stringify(undo)+').length===2');
    await ctrlZ(b);await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"');
    assert.equal((await http.detail(second)).assignee_id,null);
    assert.equal((await http.detail(id)).status,'IN_PROGRESS');
    assert.equal(await b.evaluate('document.querySelectorAll('+JSON.stringify(undo)+').length'),1);
  }));
});
