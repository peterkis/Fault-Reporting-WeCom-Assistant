import assert from 'node:assert/strict';
import {test} from 'node:test';
import {query} from './helpers/motion-board-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {
  type Browser, options, withScene, claim, openDetail, fillClose, toast, confirmClose, follow, visible,
  active,
} from './helpers/card37a-optimistic-fixture.mjs';

// Record real requests and drop just the first successful POST response. A held
// response remains outstanding until the controller aborts on timeout or unmount.
async function loseCommittedResponse(b:Browser,suffix:string,hold=false){
  await b.evaluate(`(()=>{
    const original=window.fetch.bind(window),suffix=${JSON.stringify(suffix)};
    const trace=window.pr1Recovery={writes:[],receipts:[],committed:false};
    window.fetch=async(input,init)=>{
      const path=new URL(input instanceof Request?input.url:input,location.href).pathname;
      if(init?.method==='POST'&&path.endsWith(suffix)){
        trace.writes.push(JSON.parse(init.body));const first=trace.writes.length===1;
        const result=await original(input,init);
        if(first&&result.ok){
          trace.committed=true;
          if(${hold})await new Promise((_,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
          throw new TypeError('Synthetic lost response');
        }
        return result;
      }
      const result=await original(input,init);
      if(path.includes('/commands/')||path.includes('/conversation-handling-commands/'))trace.receipts.push({path,state:(await result.clone().json()).state});
      return result;
    };
  })()`);
}

test('37A PR1 each lost Undo response can be checked from the item under its original UUID',options,async t=>{
  for(const action of ['return','restore','follow'] as const)await t.test(action,()=>withScene(async s=>{
    const {b}=s;
    if(action==='return')await claim(b,s.card);
    if(action==='restore'){await fillClose(s);await clickWorkbenchControl(b,confirmClose);}
    if(action==='follow'){await openDetail(s);await clickWorkbenchControl(b,follow);}
    const forward=action==='return'?'ticket-self-handling':action==='restore'?'ticket-waiting-cancel':'item-follow';
    const inverse=action==='return'?'ticket-return-to-dispatch':action==='restore'?'closure-restore':'item-follow';
    const path=action==='return'?'/return-to-dispatch':action==='restore'?'/restore':'/follow';
    await b.waitFor(visible(toast(forward)+' [data-toast-action=undo]'));
    await loseCommittedResponse(b,path,action==='return');
    await clickWorkbenchControl(b,toast(forward)+' [data-toast-action=undo]');
    await b.waitFor('pr1Recovery.committed');
    const view=toast(inverse)+' [data-toast-action=view]';
    await b.waitFor(visible(view),{timeoutMs:12000});await clickWorkbenchControl(b,view);
    await b.waitFor(visible('#detail-title'));
    if(action!=='follow'){
      const entry=action==='return'?'[data-step-action=return]':'.ds-next-step [data-action=restore-dismissed]';
      await b.waitFor(query(entry)+'!==null');await clickWorkbenchControl(b,entry);
    }
    const check=action==='return'?'.detail-return-dialog [data-action=check-return-to-dispatch-command]':action==='restore'?'[data-action=check-restore-command]':'[data-action=follow-ack]';
    await clickWorkbenchControl(b,check);
    await b.waitFor(`pr1Recovery.receipts.some(r=>r.path.endsWith(${JSON.stringify(path+'/commands/')}+pr1Recovery.writes[0].client_command_id)&&r.state==='COMMITTED')`);
    await b.waitFor('!('+visible(check)+')');
    assert.equal(await b.evaluate('pr1Recovery.writes.length'),1);
  }));
});

test('37A PR1 detail claim blocks navigation while submitting and a remount recovers the committed command',options,async t=>{
  for(const scenario of ['self claim','conversation claim','conversation claim with an expired draft'] as const){
    const conversationClaim=scenario!=='self claim',draftRecovery=scenario==='conversation claim with an expired draft';
    await t.test(scenario,()=>withScene(async s=>{
      const {b,card}=s,action=conversationClaim?'take-and-start-with-conversations':'take-and-start';
      await openDetail(s);await loseCommittedResponse(b,'/'+action,true);
      await clickWorkbenchControl(b,'.detail-dialog [data-action='+action+']');await b.waitFor('pr1Recovery.committed');
      await b.waitFor(query('[aria-label=关闭详情]')+'?.disabled===true');
      // Browser history can still unmount a keyed drawer independently of its buttons.
      await b.evaluate('window.history.back()');await b.waitFor('!document.querySelector("#detail-title")');
      if(draftRecovery)await b.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()');
      await openDetail(s);
      if(!draftRecovery){
        const recoveryButton=conversationClaim?'[data-action=open-conversation-handling-recovery]':'[data-action=check-self-handling]';
        await b.waitFor(visible(recoveryButton));
        await b.waitFor("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))");
      }
      if(conversationClaim)await clickWorkbenchControl(b,'[data-action=open-conversation-handling-recovery]');
      if(draftRecovery){
        await b.waitFor('document.body.innerText.includes("草稿已过期")');
        await clickWorkbenchControl(b,'[data-action=check-expired-conversation-handling]');
        await b.waitFor(`pr1Recovery.receipts.some(r=>r.path==='/api/tickets/${s.id}/conversation-handling-commands/'+pr1Recovery.writes[0].client_command_id&&r.state==='COMMITTED')`);
        assert.equal(await b.evaluate('pr1Recovery.writes.length'),1);
      }else{
        assert.equal(await b.evaluate('pr1Recovery.writes.length'),1,'remount must not replay automatically');
        if(conversationClaim)assert.equal(await b.evaluate(query('[data-action=check-expired-conversation-handling]')+'===null'),true);
        await clickWorkbenchControl(b,conversationClaim?'[data-action=check-conversation-handling]':'.detail-dialog [data-action=check-self-handling]');
        await b.waitFor('pr1Recovery.writes.length===2');
        assert.deepEqual(await b.evaluate('pr1Recovery.writes[1]'),await b.evaluate('pr1Recovery.writes[0]'));
        if(conversationClaim)assert.equal(await b.evaluate("pr1Recovery.receipts.filter(r=>r.path.includes('/conversation-handling-commands/')).length"),0);
      }
      await b.waitFor(visible(active(card))+'&&!'+query(card+'[data-optimistic-state]'));
    },{conversationClaim,draftRecovery}));
  }
});

test('37A PR1 a lost detail close response uses the original dismiss receipt',options,()=>withScene(async s=>{
  const {b}=s;
  await fillClose(s);await loseCommittedResponse(b,'/dismiss',true);await clickWorkbenchControl(b,confirmClose);
  await b.waitFor('pr1Recovery.committed');
  const check='[data-action=check-cancel-command]';
  await b.waitFor(visible(check),{timeoutMs:12000});await clickWorkbenchControl(b,check);
  await b.waitFor("pr1Recovery.receipts.some(r=>r.path.endsWith('/dismiss/commands/'+pr1Recovery.writes[0].client_command_id)&&r.state==='COMMITTED')");
  assert.equal(await b.evaluate('pr1Recovery.writes.length'),1);
}));
