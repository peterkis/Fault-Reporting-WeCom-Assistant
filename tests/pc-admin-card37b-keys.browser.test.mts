import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {
  board,
  chip,
  current,
  frame,
  help,
  hint,
  key,
  navigate,
  palette,
  record,
  target,
  suite,
  scene,
  writeLog,
  actions,
  title,
  seen,
  undoFor,
  number,
  takeoverSection,
  takeoverTeam,
  takeoverScene,
} from './helpers/card37b-keyboard-browser.mjs';
import {type Scene,closeDialog,ctrlZ,follow,heading,toast,visible,withScene} from './helpers/card37a-optimistic-fixture.mjs';
import {query,seedMotionTicket} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';

async function copy(s:Scene,id:string,kind='ticket'){
  const value=await number(s,id,kind);
  await s.b.command('Browser.grantPermissions',{origin:s.f.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await s.b.evaluate("navigator.clipboard.writeText('等待复制（合成）')");
  await key(s.b,'c');
  await s.b.waitFor(heading('copy-number')+'==='+JSON.stringify('已复制编号 '+value));
  assert.equal(await s.b.evaluate('navigator.clipboard.readText()'),value);
}

for(const surface of ['board','list','drawer'] as const){
  test('37B B5.1 item keys on '+surface,suite,t=>scene(async s=>{
    const {b,http,f,id}=s;
    const mine=await seedMotionTicket(f.pool,'我的处理中工单');
    const theirs=await seedMotionTicket(f.pool,'同事已领取');
    await http.start(mine);
    await (await t11Http(f,2,{closeConnections:true})).start(theirs);
    for(const action of actions)await t.test('available '+action,async()=>{
      const item=action==='d'?mine:id;
      const owner=await target(s,surface,item);
      if(action==='a'){
        // Keyboard selection can precede the command-context read. Exercise the
        // admitted control here; the held-read case separately covers an early A.
        const claim=owner+(surface==='drawer'?' [data-action=take-and-start]':' [data-board-claim-action]');
        await b.waitFor(query(claim)+'?.matches(":enabled:not([aria-disabled=true])")===true');
      }
      if(surface==='drawer'){
        const ready:Record<string,string>={a:'[data-action=take-and-start]',t:'[data-action=open-assignment]',d:'.detail-complete-button,[data-step-action=complete]',m:'#internal-note',x:'[data-action=cancel]',f:follow};
        if(ready[action])await b.waitFor(seen(ready[action]));
      }
      await record(b);
      if(action==='c'){await copy(s,item);return;}
      await key(b,action);
      if(action==='a'){
        await b.waitFor(visible(undoFor('ticket-self-handling')));
        assert.equal((await http.detail(id)).status,'IN_PROGRESS');
        await ctrlZ(b);
        await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"');
        assert.equal((await http.detail(id)).assignee_id,null);
      }else if(action==='f'){
        await b.waitFor(visible(undoFor('item-follow')));
        assert.equal(await b.evaluate(writeLog+'.filter(([,p])=>p.endsWith("/follow")).length'),1);
        await ctrlZ(b);
        await b.waitFor(heading('item-follow')+'==="已撤销"');
      }else{
        const selector={t:'.detail-assignment-dialog',d:'#completion-process',x:closeDialog,m:'#internal-note'}[action];
        await b.waitFor(visible(selector));
        if(action==='m')await b.waitFor('document.activeElement==='+query(selector));
        assert.deepEqual(await b.evaluate(writeLog),[],action+' only opens the original entry');
        if(action!=='x')assert.equal(await b.evaluate('location.pathname'),'/workbench/app/items/ticket/'+item);
      }
    });
    await t.test('unavailable claim and completion',async()=>{
      for(const [action,item,message] of [['a',theirs,'这张工单现在不能领取'],['d',id,'这张工单现在不能登记完工']] as const){
        await target(s,surface,item);
        await record(b);
        await key(b,action);
        await b.waitFor(title(hint)+'==='+JSON.stringify(message));
        assert.deepEqual(await b.evaluate('b5log.calls'),[],surface+' '+action);
      }
    });
    if(surface!=='drawer')await t.test('no keyboard target',async()=>{
      await board(s,surface);
      assert.equal(await b.evaluate(seen(current)),false);
      const path=await b.evaluate('location.href');
      await record(b);
      for(const action of actions)await key(b,action);
      await b.evaluate(frame);
      assert.equal(await b.evaluate('location.href'),path);
      assert.equal(await b.evaluate(seen([current,help,hint,closeDialog,'.detail-dialog',toast('copy-number')].join(','))),false);
      assert.deepEqual(await b.evaluate('b5log.calls'),[]);
    });
  }));
}

test('37B B5.1 movement, workspace keys and detail precedence',suite,t=>scene(async s=>{
  const {b,id}=s;
  for(const view of ['board','list'] as const)await t.test(view,async()=>{
    await board(s,view);
    const stage=(i:number)=>view==='board'?'.board-column.'+['pending','active','handled'][i]:'#list-'+['pending','active','handled'][i];

    await waitForAnimationsSettled(b);
    for(const i of [0,1,2]){
      const first=await b.evaluate(`[...${query(stage(i))}.querySelectorAll('a.card-open')].find(n=>n.checkVisibility()&&!n.closest('[hidden],[inert],[aria-hidden=true]'))?.href`);
      assert.equal(typeof first,'string',stage(i)+' fixture requires a navigable item');
      await key(b,String(i+1));
      assert.equal(await b.evaluate('document.activeElement.href'),first);
    }
    await key(b,'1');
    const first=await b.evaluate('document.activeElement.href');
    await key(b,'j');assert.notEqual(await b.evaluate('document.activeElement.href'),first);
    await key(b,'k');assert.equal(await b.evaluate('document.activeElement.href'),first);
    for(const [letter,column] of [['l',1],['h',0]] as const){
      await key(b,letter);
      if(view==='board')assert.equal(await b.evaluate(query(stage(column))+'.contains(document.activeElement)'),true);
      else assert.equal(await b.evaluate('document.activeElement.href'),first);
    }
    await key(b,'/');assert.equal(await b.evaluate("document.activeElement.matches('.workbench-search input[name=q]')"),true);
    await b.evaluate('document.activeElement.blur()');
    await key(b,'v');await b.waitFor(visible(view==='board'?'.ds-work-table':'.board'));
    await key(b,'n');await b.waitFor(visible('[data-manual-report-form]'));
  });
  await t.test('drawer J and K use neighbouring detail, C uses detail, Escape returns',async()=>{
    await target(s,'board',id);await key(b,'Enter');await b.waitFor(visible('.detail-dialog #detail-title'));
    const original=await b.evaluate('location.pathname');
    const next='.detail-next[aria-label=下一项]';
    await b.waitFor(query(next)+'?.disabled===false');
    // Read the original next/previous buttons' destination without a pointerdown
    // clearing keyboard-current on the background board.
    await b.evaluate(query(next)+'.click()');
    await b.waitFor('location.pathname!=='+JSON.stringify(original)+'&&'+visible('.detail-dialog .ds-next-step'));
    const nextPath=String(await b.evaluate('location.pathname'));
    await b.evaluate(query('.detail-previous')+'.click()');
    await b.waitFor('location.pathname==='+JSON.stringify(original));
    await waitForAnimationsSettled(b,'.detail-dialog');
    await b.evaluate(query(next)+'.focus()');
    await key(b,'j');await b.waitFor('location.pathname==='+JSON.stringify(nextPath));
    const parts=nextPath.split('/'),other=parts.at(-1),kind=parts.at(-2);
    assert.ok(other&&kind);
    await b.waitFor(visible('.detail-dialog .ds-next-step'));
    assert.equal(await b.evaluate(query(current)+'?.dataset.itemId'),id);
    await copy(s,other,kind);
    await key(b,'k');await b.waitFor('location.pathname==='+JSON.stringify(original));
    await key(b,'Escape');await b.waitFor('!'+seen('.detail-dialog'));
    await navigate(s,'items/'+kind+'/'+other+'?detail=page',visible('.detail-page .ds-next-step'));
    await copy(s,other,kind);
    await key(b,'Escape');await b.waitFor(visible('.board'));
  });
}));

test('37B B5.1 accepted by me keeps the admitted drawer claim action',suite,()=>scene(async s=>{
  const {b,http,id}=s,prior=await http.detail(id);
  const accepted=await http.post(id,'accept-for-later',{client_command_id:randomUUID(),expected_version:prior.version,
    reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:prior.resolver_team_id});
  assert.equal(accepted.status,200,await accepted.text());
  await target(s,'drawer');
  await b.waitFor(query('[data-action=take-and-start]')+'?.disabled===false');
  await record(b);await key(b,'a');
  await b.waitFor(heading('ticket-self-handling')+'==="已领取"');
  assert.equal((await http.detail(id)).status,'IN_PROGRESS');
  assert.equal(await b.evaluate(writeLog+'.filter(([,p])=>p.endsWith("/take-and-start")).length'),1);
}));

test('37B B5.1 B5.7 restricted account across board, list and drawer',suite,t=>withScene(async s=>{
  const {b,id}=s;
  // The fixture supplies authenticated worker reads. Replace only the UI bootstrap
  // role to exercise the read-only projection; the server actually disables follow.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const fetch=window.fetch;window.fetch=async function(input,init){
      const response=await fetch.call(this,input,init);
      if(new URL(input.url??input,location.href).pathname!=='/api/lifecycle/bootstrap'||!response.ok)return response;
      const body=await response.json();body.roles=['REPORTER'];window.b5Role=body.roles[0];return Response.json(body);
    };
  })()`});
  for(const view of ['board','list','drawer'] as const)await t.test(view,async()=>{
    if(view==='drawer'){
      await navigate(s,'items/ticket/'+id,visible('.detail-dialog .ds-next-step'));
      await b.evaluate(query('.detail-dialog [aria-label=复制编号]')+'.focus()');
    }else await target(s,view);
    assert.equal(await b.evaluate('window.b5Role'),'REPORTER');
    await key(b,'?');await b.waitFor(visible(help+' [data-shortcut-id=copy-number]'));
    assert.equal(await b.evaluate(seen(help+' [data-shortcut-id=close]')),false);
    assert.equal(await b.evaluate(query(help)+'.innerText.includes("关闭事项…")'),false);
    await key(b,'Escape');await b.waitFor('!'+seen(help));
    const url=await b.evaluate('location.href');
    for(const [letter,copy] of [['a','你没有领取这张工单的权限'],['t','你没有转交这张工单的权限'],
      ['d','你没有登记完工的权限'],['x','你没有关闭这张工单的权限'],['f','你没有关注工单的权限'],['m','你没有写内部备注的权限']] as const){
      await record(b);await key(b,letter);await b.waitFor(title(hint)+'==='+JSON.stringify(copy));
      assert.deepEqual(await b.evaluate('b5log.calls'),[],view+' '+letter);
      assert.equal(await b.evaluate('location.href'),url);
      assert.equal(await b.evaluate(seen(closeDialog+',.detail-assignment-dialog')),false);
      assert.equal(await b.evaluate(query(hint)+'.closest("[inert],[aria-hidden=true]")'),null);
    }
    await copy(s,id);
  });
},{keyboard:true,followEnabled:false}));

test('37B B5.1 workspace and detail navigation by context',suite,t=>scene(async s=>{
  const {b}=s;
  for(const view of ['board','list','drawer'] as const)await t.test(view,async()=>{
    await target(s,view);
    await key(b,'k',2);
    if(view==='drawer'){
      const url=await b.evaluate('location.href');
      assert.equal(await b.evaluate(seen(palette)),false);
      for(const letter of ['h','l','1','2','3','n','v','/'])await key(b,letter);
      assert.equal(await b.evaluate('location.href'),url);
      assert.equal(await b.evaluate('document.activeElement.matches("input")'),false);
    }else{
      await b.waitFor(visible(palette));await key(b,'Escape');await b.waitFor('!'+seen(palette));
      await key(b,'Enter');await b.waitFor(visible('.detail-dialog #detail-title'));
      assert.equal(await b.evaluate('location.pathname'),'/workbench/app/items/ticket/'+s.id);
      await key(b,'Escape');await b.waitFor('!'+seen('.detail-dialog'));
    }
    for(const [letter,path] of [['w','/'],['c','/conversations'],['n','/notification-exceptions']] as const){
      await target(s,view);await key(b,'g');await b.waitFor(visible(chip));await key(b,letter);
      await b.waitFor('location.pathname==='+JSON.stringify('/workbench/app'+path)+'&&!'+seen(chip));
    }
  });
}));

test('37B B5.1 unavailable item actions reuse command admission before navigating',suite,t=>withScene(async s=>{
  const {b,f,http}=s;
  const mine=await seedMotionTicket(f.pool,'只由原处理人办理');
  await http.start(mine);
  const reopened=await seedMotionTicket(f.pool,'等待重新派单');
  await f.pool.query("UPDATE pilot_ticket.ticket SET status='REOPENED' WHERE id=$1::uuid",[reopened]);
  const peer=await t11Http(f,2,{closeConnections:true}),cookie=f.browserCookies[2],actorCookie=f.browserCookies[0];
  const handler=f.principals[1];assert.ok(cookie&&actorCookie&&handler);
  // The isolated auth fixture issues distinct names and resolves the first
  // configured match. Remove the actor session before selecting the handler.
  await b.command('Network.deleteCookies',{name:actorCookie.name,url:f.origin+'/'});
  await b.command('Network.setCookie',{...cookie,url:f.origin+'/'});
  const browserPrincipal=await b.evaluate(`(async()=>{
    const response=await fetch('/api/lifecycle/bootstrap',{cache:'no-store'});
    const {principal_id,roles}=await response.json();return {status:response.status,principal_id,roles};
  })()`);
  assert.deepEqual(browserPrincipal,{status:200,principal_id:handler.id,roles:['HANDLER']});
  for(const [letter,item,admissions,verb] of [
    ['t',reopened,['assign','transfer-assignment'],'转交'],['d',mine,['complete'],'登记完工'],['m',mine,['add-note'],'写内部备注'],
  ] as const){
    const ctx=await peer.detail(item);
    assert.ok(admissions.every(action=>!ctx.allowed_actions.includes(action)),'fixture requires denied '+verb);
    for(const view of ['board','list','drawer'] as const)await t.test(view+' '+letter,async()=>{
      if(view==='drawer'){
        await navigate(s,'items/ticket/'+item,visible('.detail-dialog .ds-next-step'));
        await b.evaluate(query('.detail-dialog [aria-label=复制编号]')+'.focus()');
      }else await target(s,view,item);
      const previous=await b.evaluate('location.href');
      await record(b);await key(b,letter);
      await b.waitFor(seen(hint)+'||location.href!=='+JSON.stringify(previous));
      assert.equal(await b.evaluate('location.href'),previous,'denied '+verb+' stays on its original surface');
      assert.match(String(await b.evaluate(title(hint))),new RegExp(verb,'u'));
      assert.deepEqual(await b.evaluate('b5log.calls'),[],'denied '+verb+' makes no request');
    });
  }
},{keyboard:true,followEnabled:false}));

test('37B B5.1 B5.6 unavailable workspace destinations and entry keys',suite,t=>withScene(async s=>{
  const {b}=s;
  for(const view of ['board','list','drawer'] as const)await t.test(view,async()=>{
    await target(s,view);
    const url=await b.evaluate('location.href');
    await b.evaluate('window.b5InitialFocus=document.activeElement;true');
    assert.equal(await b.evaluate(seen('[data-action=new-report]')),false);
    await record(b);
    await key(b,'n');await key(b,'/');
    assert.equal(await b.evaluate('document.activeElement===b5InitialFocus'),true);
    for(const letter of ['c','n']){
      await key(b,'g');await b.waitFor(visible(chip));
      const label=String(await b.evaluate(title(chip)));
      assert.match(label,/W 工作台/u);assert.doesNotMatch(label,/C 会话|N 通知异常/u);
      await key(b,letter);await b.waitFor('!'+seen(chip));
      assert.equal(await b.evaluate('location.href'),url);
    }
    assert.deepEqual(await b.evaluate('b5log.calls'),[]);
  });
}));

test('37B R2 Tab to a different card applies C to the focused ticket',suite,()=>scene(async s=>{
  const {b}=s;
  await target(s,'board');
  await b.command('Browser.grantPermissions',{origin:s.f.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  const limit=Number(await b.evaluate("document.querySelectorAll('a,button,input,select,textarea,[tabindex]').length"))+1;
  let focusedId:unknown;
  for(let i=0;i<limit;i++){
    await b.pressTab();
    focusedId=await b.evaluate("document.activeElement.matches('a.card-open')?document.activeElement.closest('.ticket-card[data-kind=ticket]')?.dataset.itemId:null");
    if(typeof focusedId==='string'&&focusedId!==s.id)break;
  }
  assert.ok(typeof focusedId==='string'&&focusedId!==s.id,'Tab must reach another ticket link');
  const expected=await number(s,focusedId,'ticket');
  await key(b,'c');await b.waitFor(visible(toast('copy-number')));
  assert.equal(await b.evaluate('navigator.clipboard.readText()'),expected,'C uses the ticket reached with Tab');
}));

test('37B R2 a failed command-context refresh gives feedback with zero keydown requests',suite,()=>scene(async s=>{
  const {b,card,id,f}=s,principal=f.principals[0];
  assert.ok(principal);
  await target(s,'board');
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false');
  // The initial read has admitted transfer. Fail its next read on the same
  // mounted query, so React Query retains the earlier data with an error status.
  await b.evaluate(`(()=>{
    const original=window.fetch;
    window.fetch=function(input,init){
      if(new URL(input.url??input,location.href).pathname===${JSON.stringify('/api/tickets/'+id)}){
        return Promise.resolve(Response.json({error:{code:'P2_016_PROVIDER_UNAVAILABLE'}},{status:503}));
      }
      return original.apply(this,arguments);
    };
    const channel=new BroadcastChannel('wecom-workbench-drafts-v1');
    channel.postMessage(${JSON.stringify({principal:principal.id,kind:'ticket',id,purpose:'waiting-cancel',reason:'revoked'})});
    channel.close();
  })()`);
  await b.waitFor(visible('.board-claim-controller [data-action=refresh-self-handling]'));
  const url=await b.evaluate('location.href');
  await record(b);await key(b,'t');
  await b.evaluate(frame);
  assert.equal(await b.evaluate('location.href'),url);
  assert.deepEqual(await b.evaluate('b5log.calls'),[]);
  assert.equal(await b.evaluate(title(hint)),'暂时无法确认工单操作，请稍后再试');
}));

test('37B PR1 claim denied by both workflows gives the existing hint with zero requests', suite, () =>
  takeoverScene(async s => {
    const {b, http, id} = s, activeTicket = await http.start(id);
    const completed = await http.post(id, 'complete', http.command(activeTicket));
    assert.equal(completed.status, 200, await completed.text());
    const allowed = (await http.detail(id)).allowed_actions;
    assert.deepEqual(allowed.filter(a => ['takeover', 'takeover-and-start', 'take-and-start', 'take-and-start-with-conversations'].includes(a)), []);
    await target(s, 'drawer');
    await b.waitFor(query(takeoverSection) + '?.closest(".ds-step-workflow")?.dataset.stepReadState === "ready"');
    await record(b); await key(b, 'a');
    await b.waitFor(title(hint) + ' === "这张工单现在不能领取"');
    assert.equal(await b.evaluate(visible(takeoverTeam)), false);
    assert.deepEqual(await b.evaluate('b5log.calls'), []);
  }));
