import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setImmediate as nextTurn,setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {ModuleKind,ScriptTarget,transpileModule} from 'typescript';

const source=resolve(process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),'app/pc-admin/src/features/optimistic');
const ticket={kind:'ticket',id:'ticket-a',intake_id:'intake-a',column:'pending',closure:null};
type Card=typeof ticket;
type Anchor={column:string;subgroup:string;beforeKey:string|null;afterKey:string|null;index:number};
type Entry={itemKey:string;kind:'claim';slot:'movement';clientCommandId:string;status:'pending';startedAt:number;
  undo?:boolean;from:{column:string};to:{column:string;restorePosition?:Anchor}};
interface Snapshot {rollbackCues:Map<string,{revision:number}>;positionPins:Map<string,Anchor>;overlays:ReadonlyMap<string,unknown>}
interface Store {
  triggerRollbackCue:(pid:string,kind:string,id:string,op:string,intake:string,origin:string)=>Promise<void>;
  useItemRollbackCue:(pid:string,item:Card,visible:boolean)=>{active:boolean;revision:number;onFinished:()=>void};
  beginOptimisticOverlay:(pid:string,entry:Entry)=>void;
  confirmOptimisticOverlay:(pid:string,key:string,slot:string,command:string)=>void;
  removeOptimisticOverlay:(pid:string,key:string,slot:string,command:string)=>void;
  useOptimisticSnapshot:(pid:string)=>Snapshot;
  readBoardPage:<T extends {items:Card[]}>(pid:string,signal:AbortSignal,read:()=>Promise<T>)=>Promise<T>;
  clearOptimisticState:(pid:string)=>void;
}
interface Overlay {
  applyOptimisticPositions:(order:Card[],snapshot:Snapshot)=>Card[];
  reconcileConfirmedOverlays:(pid:string,order:Card[],snapshot:Snapshot)=>void;
}

function loadModule(name:string,dependencies:Record<string,unknown>,globals:Record<string,unknown>={}){
  const code=transpileModule(readFileSync(resolve(source,name+'.ts'),'utf8'),{
    compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022},
  }).outputText;
  const exports={};
  runInNewContext(code,{exports,setTimeout,clearTimeout,...globals,require:(id:string)=>{
    assert.ok(Object.hasOwn(dependencies,id),'unexpected dependency '+id);return dependencies[id];
  }});
  return exports;
}

function setup(){
  // Each mounted copy owns a layout effect. Rendering an unchanged sibling must not run its cleanup.
  const effects=new Map<string,{deps:readonly unknown[];cleanup:void|(()=>void)}>();
  const refs=new Map<string,{current:unknown}>();
  let instance='default';
  const react={
    useSyncExternalStore:(_subscribe:unknown,getSnapshot:()=>Snapshot)=>getSnapshot(),
    useRef:(initial:unknown)=>{
      if(!refs.has(instance))refs.set(instance,{current:initial});
      return refs.get(instance);
    },
    useLayoutEffect:(effect:()=>void|(()=>void),deps:readonly unknown[])=>{
      const previous=effects.get(instance);
      if(previous&&deps.length===previous.deps.length&&deps.every((value,i)=>Object.is(value,previous.deps[i])))return;
      previous?.cleanup?.();effects.set(instance,{deps,cleanup:effect()});
    },
  };
  const store=loadModule('store',{react,'./constants':loadModule('constants',{})}) as Store;
  const overlay=loadModule('overlay',{'./store':store}) as Overlay;
  const renderCopy=(surface:'workbench'|'reminder',expanded=true)=>{
    instance=surface;
    try{return store.useItemRollbackCue('handler',ticket,expanded);}
    finally{instance='default';}
  };
  const unmount=(id='default')=>{effects.get(id)?.cleanup?.();effects.delete(id);refs.delete(id);};
  return {store,overlay,renderCopy,unmount};
}

test('37A hidden and unmounted return rows release the board reread and discard the flash',async()=>{
  const {store,unmount}=setup(),pid='handler',key='ticket:'+ticket.id;
  const trigger=()=>store.triggerRollbackCue(pid,ticket.kind,ticket.id,'claim',ticket.intake_id,ticket.column);
  const render=(visible:boolean)=>store.useItemRollbackCue(pid,ticket,visible);
  const hasCue=()=>store.useOptimisticSnapshot(pid).rollbackCues.has(key);
  const noLateFlash=()=>{assert.equal(hasCue(),false);assert.equal(render(true).active,false);};

  const absent=trigger();await nextTurn();
  assert.equal(hasCue(),false,'no mounted row can acknowledge this revision');
  await absent;noLateFlash();

  const hidden=trigger();assert.equal(render(false).active,false);
  await nextTurn();assert.equal(hasCue(),false);await hidden;noLateFlash();

  let rereads=0;
  const collapsed=trigger().then(()=>{rereads++;});
  assert.equal(render(true).active,true);await nextTurn();assert.equal(rereads,0);
  assert.equal(render(false).active,false);await nextTurn();assert.equal(rereads,1);
  await collapsed;noLateFlash();

  const disappearing=trigger().then(()=>{rereads++;});
  assert.equal(render(true).active,true);await nextTurn();assert.equal(rereads,1);
  unmount();await disappearing;assert.equal(rereads,2);noLateFlash();

  const shown=trigger().then(()=>{rereads++;}),cue=render(true);
  await nextTurn();assert.equal(rereads,2,'the visible cue still owns the reread');
  cue.onFinished();
  render(true);await shown;assert.equal(rereads,3);
});

test('37A a rejected second claim preserves the position restored by Undo',()=>{
  for(const alreadyReread of [false,true]){
    const {store,overlay}=setup(),pid='handler',key='ticket:'+ticket.id;
    const neighbour={...ticket,id:'ticket-b'},serverOrder=[ticket,neighbour];
    const pin={column:'pending',subgroup:'ticket',index:1,beforeKey:'ticket:'+neighbour.id,afterKey:null};
    const snap=()=>store.useOptimisticSnapshot(pid);
    const displayed=()=>Array.from(overlay.applyOptimisticPositions(serverOrder,snap()),card=>card.id);
    const claim:Entry={itemKey:key,kind:'claim',slot:'movement',status:'pending',startedAt:0,
      clientCommandId:'claim-again',from:{column:'pending'},to:{column:'active'}};
    try{
      store.beginOptimisticOverlay(pid,{...claim,clientCommandId:'undo',undo:true,from:{column:'active'},to:{column:'pending',restorePosition:pin}});
      store.confirmOptimisticOverlay(pid,key,'movement','undo');
      if(alreadyReread)overlay.reconcileConfirmedOverlays(pid,serverOrder,snap());
      assert.deepEqual(displayed(),[neighbour.id,ticket.id]);
      store.beginOptimisticOverlay(pid,claim);
      store.removeOptimisticOverlay(pid,key,'movement',claim.clientCommandId);
      assert.deepEqual(displayed(),[neighbour.id,ticket.id],'rejecting the new claim must keep the old index');
      store.beginOptimisticOverlay(pid,{...claim,clientCommandId:'successful-claim'});
      store.confirmOptimisticOverlay(pid,key,'movement','successful-claim');
      overlay.reconcileConfirmedOverlays(pid,[{...ticket,column:'active'},neighbour],snap());
      assert.equal(snap().positionPins.has(key),false,'a successful move retires the pin');
    }finally{store.clearOptimisticState(pid);}
  }
});

test('37A stale board data after a rejected second claim cannot retire an Undo pin',async()=>{
  const {store,overlay}=setup(),pid='handler',key='ticket:'+ticket.id;
  const neighbour={...ticket,id:'ticket-b'};
  const cached={items:[{...ticket,column:'active'},neighbour]},refreshed={items:[ticket,neighbour]};
  const pin={column:'pending',subgroup:'ticket',index:1,beforeKey:'ticket:'+neighbour.id,afterKey:null};
  const claim:Entry={itemKey:key,kind:'claim',slot:'movement',status:'pending',startedAt:0,clientCommandId:'retry',
    from:{column:'pending'},to:{column:'active'}};
  const signal=new AbortController().signal,snap=()=>store.useOptimisticSnapshot(pid);
  const restore=(id:string)=>{
    store.beginOptimisticOverlay(pid,{...claim,clientCommandId:id,undo:true,from:{column:'active'},to:{column:'pending',restorePosition:pin}});
    store.confirmOptimisticOverlay(pid,key,'movement',id);
  };
  try{
    restore('previous-undo');
    let releaseOldRead=()=>{};
    const oldRead=store.readBoardPage(pid,signal,()=>new Promise<typeof cached>(resolve=>{releaseOldRead=()=>resolve(cached);}));
    restore('latest-undo');
    store.beginOptimisticOverlay(pid,claim);
    store.removeOptimisticOverlay(pid,key,'movement',claim.clientCommandId);
    overlay.reconcileConfirmedOverlays(pid,cached.items,snap());
    assert.ok(snap().positionPins.has(key),'rendering the pre-Undo active cache must keep the pin');
    releaseOldRead();await oldRead;
    assert.ok(snap().positionPins.has(key),'a GET predating the latest pin cannot retire it');
    const aborted=new AbortController();
    await store.readBoardPage(pid,aborted.signal,async()=>{aborted.abort();return cached;});
    assert.ok(snap().positionPins.has(key),'a cancelled read has no authority over the pin');
    await assert.rejects(store.readBoardPage(pid,signal,async()=>{throw Error('offline');}),/offline/);
    await store.readBoardPage(pid,signal,async()=>({items:[neighbour]}));
    const page=await store.readBoardPage(pid,signal,async()=>refreshed);
    overlay.reconcileConfirmedOverlays(pid,page.items,snap());
    assert.deepEqual(Array.from(overlay.applyOptimisticPositions(page.items,snap()),item=>item.id),[neighbour.id,ticket.id]);
    await store.readBoardPage(pid,signal,async()=>cached);
    assert.equal(snap().positionPins.has(key),false,'a new GET showing a subsequent move retires the pin');
    restore('unreconciled-undo');
    const departure=await store.readBoardPage(pid,signal,async()=>cached);
    overlay.reconcileConfirmedOverlays(pid,departure.items,snap());
    assert.equal(snap().overlays.has(key),false,'a confirmed Undo must not mask a newer authorized departure');
  }finally{store.clearOptimisticState(pid);}
});

test('37A the visible reminder card keeps the board reread pending until its own outline finishes',async()=>{
  const {store,renderCopy}=setup(),pid='handler';
  let rereads=0;
  const returned=store.triggerRollbackCue(pid,'ticket',ticket.id,'claim',ticket.intake_id,'pending').then(()=>{rereads++;});
  const reminder=renderCopy('reminder');
  assert.equal(reminder.active,true);await nextTurn();assert.equal(rereads,0);
  reminder.onFinished();await returned;assert.equal(rereads,1);
  assert.equal(renderCopy('reminder').active,false);
});

test('37A replacing a visible card during rollback waits for the new card at the same revision',async()=>{
  const {store,renderCopy,unmount}=setup(),pid='handler';
  let rereads=0;
  const returned=store.triggerRollbackCue(pid,'ticket',ticket.id,'claim',ticket.intake_id,'pending').then(()=>{rereads++;});
  const board=renderCopy('workbench');
  assert.equal(board.active,true);await nextTurn();
  unmount('workbench');
  const reminder=renderCopy('reminder');
  assert.equal(reminder.active,true);assert.equal(reminder.revision,board.revision);
  board.onFinished();await nextTurn();assert.equal(rereads,0);
  reminder.onFinished();await returned;assert.equal(rereads,1);
});

test('37A one visible registration cannot finish another',async()=>{
  for(const first of ['finish','unmount']){
    const {store,renderCopy,unmount}=setup();
    let reread=false;
    const returned=store.triggerRollbackCue('handler','ticket',ticket.id,'claim',ticket.intake_id,'pending').then(()=>{reread=true;});
    const board=renderCopy('workbench'),other=renderCopy('reminder');
    assert.equal(board.active,true);assert.equal(other.active,true);await nextTurn();
    if(first==='finish')other.onFinished();else unmount('reminder');
    await nextTurn();assert.equal(reread,false);
    assert.equal(renderCopy('workbench').revision,board.revision);
    board.onFinished();await returned;assert.equal(reread,true);
  }
});

test('37A a collapsed board disclosure releases the reread without playing an outline',async()=>{
  const {store,renderCopy}=setup(),pid='handler';
  const trigger=()=>store.triggerRollbackCue(pid,'ticket',ticket.id,'claim',ticket.intake_id,'pending');
  for(const initiallyExpanded of [false,true]){
    let reread=false;
    const returned=trigger().then(()=>{reread=true;});
    assert.equal(renderCopy('workbench',initiallyExpanded).active,initiallyExpanded);
    await nextTurn();
    assert.equal(reread,!initiallyExpanded);
    assert.equal(renderCopy('workbench',false).active,false);
    await returned;assert.equal(renderCopy('workbench',true).active,false,'expanding later must not replay the flash');
  }
});

type RecoveryScope={principal:string;kind:string;itemId:string;intakeId?:string};
type ItemRef={kind:string;id:string};
type ClaimIntent={action:string;command:{client_command_id:string;expected_version:number;communication_choice:string;sessions:{session_id:string;expected_row_version:number}[]}};
type Intent={purpose:'self'|'conversation'|'return'|'restore'|'follow'|'close';id:string;command?:unknown;requested?:unknown;action?:string;replay?:ClaimIntent};
interface RecoveryStore {
  dispatchConversationClaim<T>(scope:RecoveryScope,intent:ClaimIntent,receiptEnabled:boolean,signal:AbortSignal,send:()=>Promise<T>):Promise<T>;
  dispatchRecoverable<T>(scope:RecoveryScope,intent:Intent,signal:AbortSignal,send:()=>Promise<T>):Promise<T>;
  useCommandRecovery(scope:RecoveryScope,purpose:Intent['purpose']):{unknown:boolean;intent:Intent;scope:RecoveryScope}|undefined;
  useItemUndoRecovery(principal:string,purpose:'follow'|'restore',item:ItemRef&{intake_id:string},requested?:ItemRef):ReturnType<RecoveryStore['useCommandRecovery']>;
  forgetRecoveredCommand(scope:RecoveryScope,purpose:Intent['purpose'],id:string):boolean;
  clearItemCommandRecovery(principal:string,kind:string,itemId:string):void;
  clearCommandRecovery():void;
}
class RecoveryApiError extends Error {constructor(readonly status:number,code:string){super(code);}}
class ConfirmedRecoveryError extends RecoveryApiError {constructor(status:number,code:string,readonly commandId:string){super(status,code);}}
function recoveryStore(ttl=86400000,client:object={ApiError:RecoveryApiError,ConfirmedClaimRejection:ConfirmedRecoveryError}){
  return loadModule('command-recovery',{
    react:{useSyncExternalStore:(_subscribe:unknown,read:()=>unknown)=>read()},'../../api/client':client,
    '../drafts/encrypted-drafts':{DRAFT_TTL_MS:ttl},
  }) as RecoveryStore;
}
const recoveryScope={principal:'operator',kind:'ticket',itemId:'TICKET-A'};

test('37A PR1 lost inverse responses keep the original item command until a terminal receipt',async()=>{
  for(const purpose of ['return','restore','follow'] as const){
    const store=recoveryStore(),id='original-'+purpose;
    const intent=purpose==='follow'?{purpose,id,requested:{kind:'intake',id:'intake-a'},command:{client_command_id:id,following:false}}:{purpose,id};
    const read=()=>store.useCommandRecovery({...recoveryScope,itemId:'ticket-a'},purpose);
    await assert.rejects(store.dispatchRecoverable(recoveryScope,intent,new AbortController().signal,async()=>{
      assert.equal(read()?.intent,intent,'registered before transport');assert.equal(read()?.unknown,false);
      throw new Error('COMMAND_OUTCOME_UNKNOWN');
    }),/COMMAND_OUTCOME_UNKNOWN/);
    assert.equal(read()?.unknown,true);
    assert.equal(read()?.intent,intent);
    assert.equal(store.useCommandRecovery({...recoveryScope,principal:'other'},purpose),undefined);
    assert.equal(store.useCommandRecovery({...recoveryScope,itemId:'ticket-b'},purpose),undefined);
    await assert.rejects(store.dispatchRecoverable(recoveryScope,{purpose,id:'new-id'},new AbortController().signal,async()=>assert.fail('duplicate write')),/PENDING/);
    assert.equal(store.forgetRecoveredCommand(recoveryScope,purpose,'other-id'),false);
    assert.equal(read()?.intent.id,id);
    assert.equal(store.forgetRecoveredCommand(recoveryScope,purpose,id),true);
    assert.equal(read(),undefined);
  }
});

test('37A PR1 unmount makes the original detail command recoverable before a late transport settles',async()=>{
  for(const purpose of ['self','conversation','close'] as const){
    const store=recoveryStore(),controller=new AbortController(),id='detail-operation';
    const command=Object.freeze({client_command_id:id,expected_version:3,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:null});
    const intent=purpose==='self'?{purpose,id,action:'take-and-start',command}:{purpose,id};
    let releaseOld=()=>{};const oldPost=new Promise<void>(resolve=>{releaseOld=resolve;});
    const oldResult=store.dispatchRecoverable(recoveryScope,intent,controller.signal,()=>oldPost);
    controller.abort();
    const recovered=store.useCommandRecovery(recoveryScope,purpose);
    assert.ok(recovered?.unknown);assert.equal(recovered.intent,intent);
    if(purpose==='self'){
      let finishReplay=()=>{};const replay=new Promise<void>(resolve=>{finishReplay=resolve;});
      const result=store.dispatchRecoverable(recoveryScope,recovered.intent,new AbortController().signal,()=>replay);
      releaseOld();await oldResult;
      assert.equal(store.useCommandRecovery(recoveryScope,purpose)?.intent.command,command,'late completion cannot clear an active replay');
      finishReplay();await result;
    }else{
      releaseOld();await oldResult;
      assert.deepEqual(Object.keys(recovered.intent).sort(),['id','purpose'],'receipt recovery retains no form or conversation data');
      assert.equal(store.forgetRecoveredCommand(recoveryScope,purpose,id),true);
    }
    assert.equal(store.useCommandRecovery(recoveryScope,purpose),undefined);
  }
});

test('37A PR1 definitive rejection, underlying item revocation and logout clear the appropriate commands',async()=>{
  const store=recoveryStore(),second={...recoveryScope,itemId:'ticket-b'},intent:Intent={purpose:'restore',id:'original'};
  const fail=(scope:RecoveryScope,status:number)=>store.dispatchRecoverable(scope,intent,new AbortController().signal,async()=>{throw new RecoveryApiError(status,'FAILED');});
  for(const status of [409,503]){await assert.rejects(fail(recoveryScope,status),/FAILED/);assert.equal(store.useCommandRecovery(recoveryScope,'restore'),undefined);}
  for(const scope of [recoveryScope,second])await assert.rejects(store.dispatchRecoverable(scope,intent,new AbortController().signal,async()=>{throw new TypeError('offline');}),/offline/);
  store.clearItemCommandRecovery(recoveryScope.principal,'ticket','ticket-a');
  assert.equal(store.useCommandRecovery(recoveryScope,'restore'),undefined);assert.equal(store.useCommandRecovery(second,'restore')?.unknown,true);
  store.clearCommandRecovery();assert.equal(store.useCommandRecovery(second,'restore'),undefined);
});

test('37A PR2 a remounted combined claim has an opaque receipt when enabled and the exact replay when disabled',async()=>{
  const intent={action:'take-and-start-with-conversations',command:{client_command_id:'original-claim',expected_version:3,
    communication_choice:'TAKE_SELECTED',sessions:[{session_id:'original-session',expected_row_version:7}]}};
  for(const receiptEnabled of [false,true]){
    const store=recoveryStore(),controller=new AbortController();
    const original=store.dispatchConversationClaim(recoveryScope,intent,receiptEnabled,controller.signal,()=>new Promise<void>((_,reject)=>{
      controller.signal.addEventListener('abort',()=>reject(Error('unmounted')),{once:true});
    }));
    controller.abort();
    await assert.rejects(original,/unmounted/);
    const held=store.useCommandRecovery(recoveryScope,'conversation');
    assert.ok(held?.unknown);assert.equal(held.intent.id,intent.command.client_command_id);
    if(receiptEnabled){
      assert.deepEqual(Object.keys(held.intent).sort(),['id','purpose']);
      assert.ok(store.forgetRecoveredCommand(recoveryScope,'conversation',held.intent.id));
    }else{
      assert.equal(held.intent.replay,intent);
      await store.dispatchConversationClaim(recoveryScope,held.intent.replay,receiptEnabled,new AbortController().signal,async()=>{});
    }
    assert.equal(store.useCommandRecovery(recoveryScope,'conversation'),undefined);
  }
});

test('37A PR1 follow replay expires to an opaque receipt and revoking its original alias clears it',async()=>{
  const store=recoveryStore(0),requested={kind:'intake',id:'intake-a'},id='follow-inverse';
  const command={client_command_id:id,following:false},intent:Intent={purpose:'follow',id,requested,command};
  await assert.rejects(store.dispatchRecoverable(recoveryScope,intent,new AbortController().signal,async()=>{throw new TypeError('lost');}),/lost/);
  assert.equal(store.useCommandRecovery(recoveryScope,'follow')?.intent.command,command);
  await delay(5);
  const receipt=store.useCommandRecovery(recoveryScope,'follow');
  assert.ok(receipt?.unknown);assert.equal(receipt.intent.id,id);assert.equal(receipt.intent.requested,requested);
  assert.equal(receipt.intent.command,undefined);
  store.clearItemCommandRecovery(recoveryScope.principal,requested.kind,requested.id);
  assert.equal(store.useCommandRecovery(recoveryScope,'follow'),undefined);
});

test('37A PR1 Undo handlers register their actual inverse POST before transport and retain it for View',async()=>{
  for(const operation of ['return','restoreTicket','restoreIntake','follow','restoreReview','followReview'] as const){
    const fromReview=operation==='restoreReview'||operation==='followReview';
    const purpose=operation==='return'?'return':operation==='follow'||operation==='followReview'?'follow':'restore';
    const item=fromReview?{...ticket,kind:'review',id:'review-a'}:operation==='restoreIntake'?{...ticket,kind:'intake',id:ticket.intake_id}:ticket;
    const subject=operation==='restoreReview'?{kind:'intake',id:item.intake_id}:item;
    const scope={principal:'operator',kind:subject.kind,itemId:subject.id},store=recoveryStore();
    const requested=fromReview?{kind:item.kind,id:item.id}:{kind:'intake',id:item.intake_id},toasts:{state:string;onAction:()=>void}[]=[];
    const sent:{target:unknown;command:{client_command_id:string};registered:ReturnType<RecoveryStore['useCommandRecovery']>}[]=[];
    const post=async(target:unknown,command:{client_command_id:string})=>{
      sent.push({target,command,registered:store.useCommandRecovery(scope,purpose)});
      throw new TypeError('response lost');
    };
    const handlers=loadModule('undo-actions',{
      '../../api/client':{workbenchTransportWritable:()=>true,ApiError:RecoveryApiError,api:{
        ticketCommandContext:async()=>({version:3,assignee_id:scope.principal,allowed_actions:['return-to-dispatch','restore']}),
        detail:async()=>({item:{attention:{follow_version:'3',following:true}}}),
        returnTicket:post,restoreClosedTicket:post,follow:post,
      }},
      '../closure/client':{closureApi:{intakeContext:async()=>({version:3,can_restore:true}),restoreIntake:post}},
      '../../contracts/workbench-follow-browser-contracts.mjs':{decodeFollowCommand:(value:unknown)=>value},
      '../../app/ToastFeedback':{showErrorActionToast:(toast:typeof toasts[number])=>toasts.push(toast)},
      '../../design/motion/self-write':{markSelfWrite:()=>{}},'./constants':loadModule('constants',{}),
      './store':{optimisticItemKey:(kind:string,id:string)=>kind+':'+id,beginOptimisticOverlay:()=>{},removeOptimisticOverlay:()=>{}},
      './command-recovery':store,
    },{window:{setTimeout,clearTimeout},AbortController,crypto}) as Record<'executeClaimUndo'|'executeCloseUndo'|'executeFollowUndo',(input:Record<string,unknown>)=>Promise<void>>;
    let opened=false;
    const execute=purpose==='return'?handlers.executeClaimUndo:purpose==='follow'?handlers.executeFollowUndo:handlers.executeCloseUndo;
    try{
      await execute({principal:{principal_id:scope.principal},client:{getQueryData:()=>undefined,invalidateQueries:()=>{}},item,
        requested,committedVersion:3,previousColumn:'active',previousStatus:'IN_PROGRESS',targetFollowing:false,committedFollowVersion:'3',onOpenItem:()=>{opened=true;}});
      assert.equal(sent.length,1);
      const write=sent[0];assert.ok(write);assert.equal(write.registered?.unknown,false);
      assert.equal(write.registered.intent.id,write.command.client_command_id);
      if(purpose==='follow'){assert.equal(write.target,requested);assert.equal(write.registered.intent.command,write.command);assert.equal(write.registered.intent.requested,requested);}
      else if(operation==='restoreReview')assert.equal(write.target,item.intake_id);
      else assert.equal(write.target,item.id);
      assert.equal(toasts.length,1);assert.equal(toasts[0]?.state,'unknown');
      toasts[0]?.onAction();assert.ok(opened);
      const recovery=store.useCommandRecovery(scope,purpose);
      assert.ok(recovery?.unknown);assert.equal(recovery.intent.id,write.command.client_command_id);
      if(fromReview){
        const inverse=operation==='restoreReview'?'restore':'follow',converted={...ticket,id:'converted-ticket'};
        assert.equal(store.useItemUndoRecovery(scope.principal,inverse,converted),recovery);
        assert.equal(store.useItemUndoRecovery(scope.principal,inverse,{...converted,intake_id:'linked-ticket-source'},requested),recovery);
      }
    }finally{store.clearCommandRecovery();}
  }
});

test('37A PR4 converted Review follow resolves the original endpoint and UUID even after replay data expires',async()=>{
  const store=recoveryStore(0),review={kind:'review',id:'review-a'},id='undo-follow';
  const scope={principal:'operator',kind:review.kind,itemId:review.id,intakeId:ticket.intake_id};
  const command={client_command_id:id,canonical_item:review,following:false,expected_follow_version:'4'};
  await assert.rejects(store.dispatchRecoverable(scope,{purpose:'follow',id,requested:review,command},new AbortController().signal,async()=>{throw Error('lost');}));
  const lookup=(requested?:ItemRef)=>store.useItemUndoRecovery('operator','follow',ticket,requested);
  assert.equal(lookup(review)?.intent.command,command);
  assert.equal(lookup(ticket)?.intent.requested,review,'direct Ticket route still replays on original Review');
  assert.equal(store.useItemUndoRecovery('other','follow',ticket,review),undefined);
  await delay(5);
  const receipt=lookup(review);assert.ok(receipt?.unknown);assert.equal(receipt.intent.id,id);
  assert.equal(receipt.intent.command,undefined);assert.equal(receipt.intent.requested,review);
  assert.ok(store.forgetRecoveredCommand(receipt.scope,'follow',id));assert.equal(lookup(ticket),undefined);
});

test('37A PR4 converted Ticket restore uses the original Intake subject even when the requested Review links a different intake',async()=>{
  const store=recoveryStore(),review={kind:'review',id:'review-a'},id='undo-restore';
  const scope={principal:'operator',kind:'intake',itemId:ticket.intake_id};
  await assert.rejects(store.dispatchRecoverable(scope,{purpose:'restore',id,requested:review},new AbortController().signal,async()=>{throw Error('lost');}));
  for(const [card,requested] of [[ticket,ticket],[{...ticket,intake_id:'different-source'},review]] as const){
    const receipt=store.useItemUndoRecovery('operator','restore',card,requested);
    assert.ok(receipt?.unknown);assert.equal(receipt.scope.kind,'intake');assert.equal(receipt.scope.itemId,ticket.intake_id);assert.equal(receipt.intent.id,id);
  }
  assert.equal(store.useItemUndoRecovery('operator','restore',{...ticket,intake_id:'unrelated'},ticket),undefined);
  assert.ok(store.forgetRecoveredCommand(scope,'restore',id));
  assert.equal(store.useItemUndoRecovery('operator','restore',ticket,review),undefined);
});

test('37A PR4 a pre-ledger claim replay denial keeps the original command; only its ledger rejection settles it',async()=>{
  const ticketId=crypto.randomUUID(),commandId=crypto.randomUUID(),calls:string[]=[];
  const intent={action:'take-and-start-with-conversations',command:{client_command_id:commandId,expected_version:2,communication_choice:'TAKE_SELECTED',
    sessions:[{session_id:crypto.randomUUID(),expected_row_version:1}]}};
  const denial={ok:false,error:{code:'P2_016_NOT_FOUND',retryable:false}};
  let response=()=>Response.json(denial,{status:404});
  const transport=loadModule('../../api/client',{
    '../../../../shared/workbench-search-contracts.mjs':{},'../../../../shared/workbench-web-report-browser-contracts.mjs':{},
    '../contracts/workbench-follow-browser-contracts.mjs':{},'../features/supplement-follow-up/client':{},
    '../contracts/workbench-assignment-history-browser-contracts.mjs':{},'../contracts/workbench-manual-report-browser-contracts.mjs':{},
  },{crypto,fetch:async(path:string,options:{body:string})=>{
    assert.equal(path,'/api/tickets/'+ticketId+'/'+intent.action);
    assert.deepEqual(JSON.parse(options.body),intent.command);calls.push('POST');return response();
  }}) as {ApiError:new (status:number,code:string)=>Error;api:{ticketCommandContext:(id:string,signal:AbortSignal)=>Promise<unknown>;handleConversations:(id:string,action:string,body:ClaimIntent['command'],csrf:string,signal:AbortSignal,replay:boolean)=>Promise<unknown>}};
  const store=recoveryStore(86400000,transport),scope={principal:'operator',kind:'ticket',itemId:ticketId};
  transport.api.ticketCommandContext=async id=>{assert.equal(id,ticketId);calls.push('Ticket READ');return {};};
  for(const receiptEnabled of [false,true]){
    const signal=new AbortController().signal;
    await assert.rejects(store.dispatchConversationClaim(scope,intent,receiptEnabled,signal,async()=>{throw Error('lost');}),/lost/);
    const replay=()=>store.dispatchConversationClaim(scope,intent,receiptEnabled,signal,()=>transport.api.handleConversations(ticketId,intent.action,intent.command,'csrf',signal,true));
    response=()=>Response.json(denial,{status:404});calls.length=0;
    await assert.rejects(replay(),/COMMAND_OUTCOME_UNKNOWN/);
    assert.deepEqual(calls,['POST','Ticket READ']);const held=store.useCommandRecovery(scope,'conversation');
    assert.ok(held?.unknown);assert.equal(held.intent.id,commandId);assert.equal(held.intent.replay,receiptEnabled?undefined:intent);
    response=()=>Response.json({ok:false,error:{code:'P2_016_COMMAND_CONFLICT',retryable:false}},{status:409});
    await assert.rejects(replay(),/COMMAND_OUTCOME_UNKNOWN/);assert.equal(store.useCommandRecovery(scope,'conversation')?.intent.id,commandId);
    response=()=>Response.json({ok:false,replayed:true,error:{code:'P2_016_VERSION_CONFLICT',retryable:false}},{status:409});
    await assert.rejects(replay(),/P2_016_VERSION_CONFLICT/);assert.equal(store.useCommandRecovery(scope,'conversation'),undefined);
  }
  response=()=>Response.json(denial,{status:404});calls.length=0;
  transport.api.ticketCommandContext=async()=>{calls.push('Ticket READ');throw new transport.ApiError(403,'P2_016_FORBIDDEN');};
  const check=()=>transport.api.handleConversations(ticketId,intent.action,intent.command,'csrf',new AbortController().signal,true);
  await assert.rejects(check(),/P2_016_FORBIDDEN/);assert.deepEqual(calls,['POST','Ticket READ'],'genuine Ticket revocation still propagates');
  response=()=>Response.json({error:{code:'WORKBENCH_UNAUTHENTICATED'}},{status:401});calls.length=0;
  await assert.rejects(check(),/WORKBENCH_UNAUTHENTICATED/);assert.deepEqual(calls,['POST'],'session revocation still propagates');
});
