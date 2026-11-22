import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
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

function loadModule(name:string,dependencies:Record<string,unknown>){
  const code=transpileModule(readFileSync(resolve(source,name+'.ts'),'utf8'),{
    compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022},
  }).outputText;
  const exports={};
  runInNewContext(code,{exports,setTimeout,clearTimeout,require:(id:string)=>{
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
