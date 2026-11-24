import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {DOMParser} from '@xmldom/xmldom';
import type {Principal,WorkbenchCard} from '../../app/pc-admin/src/api/client';
import {visibleCardTags,type CardTag} from '../../app/pc-admin/src/design/status-map';
import {
  HoverCardsBoardBridge,
  HoverCardsStoreProvider,
  type HoverBridgeProbe,
} from '../../app/pc-admin/src/features/hover-cards/hover-card-store';

function syntheticCard(index:number):WorkbenchCard{
  return {
    kind:'ticket',
    id:`00000000-0000-4000-8000-00000000010${index}`,
    intake_id:`00000000-0000-4000-8000-00000000020${index}`,
    number:`IT-20261124-000${index}`,
    title:`桥接稳定测试工单 ${index}（合成）`,
    status:'IN_PROGRESS',
    column:'active',
    priority:null,
    source:'PORTAL',
    source_label:'H5报修',
    source_group:null,
    location:'门诊二楼（合成）',
    reporter_name:null,
    assignee_name:'陈明远',
    review_reason:null,
    created_at:'2026-11-24 08:00:00',
    updated_at:'2026-11-24 08:10:00',
    completed_at:null,
    closure:null,
  };
}

function syntheticPrincipal():Principal{
  return {
    principal_id:'00000000-0000-4000-8000-000000000001',
    display_name:'林舟（合成）',
    roles:['ADMIN'],
    csrf_token:'synthetic-csrf',
    authorization_revision:'rev-1',
    expires_epoch_ms:String(Date.now()+3600_000),
    current_profile_available:true,
    realtime_sse_enabled:false,
    realtime_sse_available:false,
    sse_endpoint:null,
    activity_enabled:false,
    workbench_search_enabled:true,
    workbench_follow_enabled:true,
    manual_reports_enabled:true,
    manual_report_draft_recovery_enabled:false,
    ticket_self_handling_enabled:true,
    ticket_conversation_self_handling_enabled:false,
    ticket_conversation_draft_recovery_enabled:false,
    ticket_staff_completion_enabled:true,
    staff_completion_draft_recovery_enabled:false,
    ticket_assignment_enabled:true,
    ticket_assignment_draft_recovery_enabled:false,
    ticket_takeover_enabled:true,
    ticket_takeover_draft_recovery_enabled:false,
    ticket_unassign_enabled:true,
    ticket_unassign_draft_recovery_enabled:false,
    ticket_return_to_dispatch_enabled:true,
    ticket_return_to_dispatch_draft_recovery_enabled:false,
    ticket_waiting_actions_enabled:false,
    ticket_waiting_action_draft_recovery_enabled:false,
    ticket_round_notifications_enabled:false,
    follow_up_schedules_enabled:false,
    follow_up_schedule_receipt_enabled:false,
    ticket_reopen_rounds_enabled:false,
    source_group_directory_enabled:false,
    internal_notes_enabled:true,
    draft_recovery_enabled:false,
    closure_draft_recovery_enabled:false,
    manual_review_enabled:true,
    manual_review_draft_recovery_enabled:false,
    conversation_workspace_enabled:false,
    conversation_draft_recovery_enabled:false,
    incident_candidate_workspace_enabled:false,
    incident_candidate_draft_recovery_enabled:false,
    logout_enabled:false,
    polling_interval_ms:5000,
  };
}

export async function measureHoverBridgeStability(){
  const principal=syntheticPrincipal();
  const doc=new DOMParser().parseFromString('<html><body/></html>','text/html');
  const container=doc.createDocumentFragment();
  for(const node of [doc,container]){
    const events=new EventTarget();
    Object.assign(node,{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  }
  Object.defineProperty(doc,'defaultView',{value:{document:doc,HTMLIFrameElement:class {}}});

  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const originalProbe=Object.getOwnPropertyDescriptor(globalThis,'__hoverBridgeProbe');
  const compareCalls:number[]=[];
  const publishCalls:boolean[]=[];
  const probe:HoverBridgeProbe={
    onItemsCompare:(count:number)=>{compareCalls.push(count);},
    onPublish:(changed:boolean)=>{publishCalls.push(changed);},
  };
  Object.defineProperty(globalThis,'window',{configurable:true,value:doc.defaultView});
  Object.defineProperty(globalThis,'__hoverBridgeProbe',{configurable:true,value:probe});

  try{
    const rootView=createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    const items=[syntheticCard(1),syntheticCard(2),syntheticCard(3)];
    const onFilter=()=>{};
    const renderWith=(list:readonly WorkbenchCard[],now:number)=>act(()=>{
      rootView.render(
        <HoverCardsStoreProvider principal={principal}>
          <HoverCardsBoardBridge
            items={list}
            range="all"
            handledDates={null}
            searchMode={true}
            now={now}
            onFilterByPerson={onFilter}
          />
        </HoverCardsStoreProvider>,
      );
    });

    try{
      await renderWith(items,1000);
      const mountCompares=[...compareCalls];
      const mountPublishes=[...publishCalls];

      compareCalls.length=0;
      publishCalls.length=0;
      for(let step=1;step<=10;step++){
        await renderWith(items,1000+step*60_000);
      }
      const stableCalls=[...compareCalls];
      const stablePublishes=[...publishCalls];

      // Hold `now` fixed and replace only the last item: on main `publishBoard` scans twice ([3, 3]);
      // on 39C single-pass `itemsEqual` scans once ([3]).
      compareCalls.length=0;
      publishCalls.length=0;
      const last=items[2];
      if(!last)throw new Error('Missing synthetic card');
      const changedLast:WorkbenchCard[]=[items[0]!,items[1]!,{...last,title:'更新后的工单（合成）'}];
      await renderWith(changedLast,1000+10*60_000);
      const changedLastCalls=[...compareCalls];
      const changedLastPublishes=[...publishCalls];

      return {
        mountCompares,
        mountPublishes,
        stableCalls,
        stablePublishes,
        changedLastCalls,
        changedLastPublishes,
      };
    }finally{
      await act(()=>rootView.unmount());
    }
  }finally{
    if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else Reflect.deleteProperty(globalThis,'window');
    if(originalProbe)Object.defineProperty(globalThis,'__hoverBridgeProbe',originalProbe);else Reflect.deleteProperty(globalThis,'__hoverBridgeProbe');
  }
}

export async function verifyCardTagFolding(){
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  if(!originalWindow)Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  try{
    const {applyCardTagFold,computeFoldedTagCount}=await import('../../app/pc-admin/src/design/components/TicketCard/TicketCard');
    const crowded:CardTag[]=[
      {key:'urge',label:'已催单',tone:'attention',icon:'bell'},
      {key:'review',label:'待复核',tone:'review'},
      {key:'substatus',label:'等待中',tone:'neutral',icon:'clock'},
      {key:'incomplete',label:'待补位置',tone:'neutral'},
    ];
    const base=visibleCardTags(crowded);
    const tagWidths=[64,52,64,60];
    const foldAt=(availableWidth:number,extraWidth=0,extraCount=0)=>
      computeFoldedTagCount({availableWidth,tagWidths,hasBaseHidden:base.hidden.length>0,overflowWidth:28,gap:4,extraWidth,extraCount});

    const wideFold=applyCardTagFold(base.shown,base.hidden,foldAt(260));
    const mediumFold=applyCardTagFold(base.shown,base.hidden,foldAt(170));
    const tightFold=applyCardTagFold(base.shown,base.hidden,foldAt(88));
    const zeroRoomCount=computeFoldedTagCount({
      availableWidth:50,
      tagWidths:[64,52,64,60],
      hasBaseHidden:false,
      overflowWidth:28,
      gap:4,
      extraWidth:40,
      extraCount:1,
      minSingleTagWidth:38,
    });
    const zeroRoomFold=applyCardTagFold(base.shown,base.hidden,zeroRoomCount);
    const widenedBackFold=applyCardTagFold(base.shown,base.hidden,foldAt(260));
    const followUpFold=applyCardTagFold(base.shown,base.hidden,foldAt(260,80,1));

    const withExcessColored=visibleCardTags([
      {key:'urge',label:'已催单',tone:'attention',icon:'bell'},
      {key:'supplement',label:'待补充',tone:'attention'},
      {key:'review',label:'待复核',tone:'review'},
      {key:'responsible',label:'我负责',tone:'brand'},
    ]);
    const supplementFoldedCount=computeFoldedTagCount({
      availableWidth:96,
      tagWidths:[64,52],
      hasBaseHidden:withExcessColored.hidden.length>0,
      overflowWidth:28,
      gap:4,
      extraWidth:0,
      extraCount:0,
    });
    const supplementFold=applyCardTagFold(withExcessColored.shown,withExcessColored.hidden,supplementFoldedCount);

    return {
      wide:{folded:wideFold.foldedCount,shown:wideFold.shown.map(t=>t.label),hidden:wideFold.hidden.map(t=>t.label)},
      medium:{folded:mediumFold.foldedCount,shown:mediumFold.shown.map(t=>t.label),hidden:mediumFold.hidden.map(t=>t.label)},
      tight:{folded:tightFold.foldedCount,shown:tightFold.shown.map(t=>t.label),hidden:tightFold.hidden.map(t=>t.label)},
      zeroRoom:{folded:zeroRoomFold.foldedCount,shown:zeroRoomFold.shown.map(t=>t.label),hidden:zeroRoomFold.hidden.map(t=>t.label)},
      widenedBack:{folded:widenedBackFold.foldedCount,shown:widenedBackFold.shown.map(t=>t.label),hidden:widenedBackFold.hidden.map(t=>t.label)},
      followUp:{folded:followUpFold.foldedCount,shown:followUpFold.shown.map(t=>t.label),hidden:followUpFold.hidden.map(t=>t.label)},
      supplement:{
        folded:supplementFold.foldedCount,
        shown:supplementFold.shown.map(t=>t.label),
        hidden:supplementFold.hidden.map(t=>t.label),
        hasPendingSupplement:supplementFold.hidden.some(t=>t.key==='supplement'),
      },
    };
  }finally{
    if(!originalWindow)Reflect.deleteProperty(globalThis,'window');
  }
}

export async function probeTicketCardFooterLifecycle(){
  const doc=new DOMParser().parseFromString('<html><body/></html>','text/html');
  const elemProto=Object.getPrototypeOf(doc.createElement('div')) as Record<string,unknown>;
  const origChildren=Object.getOwnPropertyDescriptor(elemProto,'children');
  const origClientWidth=Object.getOwnPropertyDescriptor(elemProto,'clientWidth');
  const origScrollWidth=Object.getOwnPropertyDescriptor(elemProto,'scrollWidth');
  const origQuerySelector=Object.getOwnPropertyDescriptor(elemProto,'querySelector');
  const origRect=Object.getOwnPropertyDescriptor(elemProto,'getBoundingClientRect');

  let rowWidth=150;
  let tagWidth=70;
  let overflowBadgeWidth=28;
  let gapPx=4;
  let measureRectReads=0;
  const tagMap:Record<string,number|undefined>={};

  const widthOf=(node:Element):number=>{
    const key=node.getAttribute('data-card-tag-key');
    if(key){measureRectReads+=1;return tagMap[key]??tagWidth;}
    if(node.getAttribute('data-card-tag-overflow')==='true')return overflowBadgeWidth;
    if(node.tagName.toLowerCase()==='svg')return 0;
    return 0;
  };
  const findByClass=(root:Node,cls:string):Element|null=>{
    for(let i=0;i<root.childNodes.length;i++){
      const child=root.childNodes.item(i);
      if(!child||child.nodeType!==1)continue;
      const el=child as Element;
      const attr=el.getAttribute('class')??'';
      if(attr.split(/\s+/u).includes(cls))return el;
      const nested=findByClass(el,cls);
      if(nested)return nested;
    }
    return null;
  };
  Object.defineProperty(elemProto,'children',{configurable:true,get(this:Node){
    const out:Element[]=[];
    for(let i=0;i<this.childNodes.length;i++){
      const child=this.childNodes.item(i);
      if(child&&child.nodeType===1)out.push(child as Element);
    }
    return out;
  }});
  Object.defineProperty(elemProto,'clientWidth',{configurable:true,get(this:Element){
    if((this.getAttribute('class')??'').split(/\s+/u).includes('card-tags'))return rowWidth;
    if((this.getAttribute('class')??'').split(/\s+/u).includes('ds-tag-content'))return tagWidth;
    return 0;
  }});
  Object.defineProperty(elemProto,'scrollWidth',{configurable:true,get(this:Element){
    if((this.getAttribute('class')??'').split(/\s+/u).includes('ds-tag-content'))return tagWidth;
    return 0;
  }});
  Object.defineProperty(elemProto,'querySelector',{configurable:true,value(this:Element,selector:string){
    if(selector.startsWith('.'))return findByClass(this,selector.slice(1));
    return null;
  }});
  Object.defineProperty(elemProto,'getBoundingClientRect',{configurable:true,value(this:Element){
    return {width:widthOf(this),height:20,top:0,left:0,right:widthOf(this),bottom:20};
  }});

  const container=doc.documentElement as unknown as Element;
  for(const node of [doc,container]){
    const events=new EventTarget();
    Object.assign(node,{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  }
  const fontEvents=new EventTarget();
  let fontAddCount=0,fontRemoveCount=0;
  const fonts={
    status:'loaded',
    ready:Promise.resolve(),
    addEventListener(type:string,listener:EventListenerOrEventListenerObject){fontAddCount+=1;fontEvents.addEventListener(type,listener);},
    removeEventListener(type:string,listener:EventListenerOrEventListenerObject){fontRemoveCount+=1;fontEvents.removeEventListener(type,listener);},
  };
  Object.defineProperty(doc,'fonts',{configurable:true,value:fonts});
  Object.defineProperty(doc,'defaultView',{configurable:true,value:{document:doc,HTMLIFrameElement:class {}}});

  let roObserveCount=0,roDisconnectCount=0;
  const roInstances:{trigger:()=>void}[]=[];
  class MockResizeObserver{
    private readonly cb:()=>void;
    constructor(cb:()=>void){this.cb=cb;roInstances.push({trigger:()=>this.cb()});}
    observe(){roObserveCount+=1;}
    disconnect(){roDisconnectCount+=1;}
  }

  const origWin=Object.getOwnPropertyDescriptor(globalThis,'window');
  const origDoc=Object.getOwnPropertyDescriptor(globalThis,'document');
  const origRO=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
  const origGCS=Object.getOwnPropertyDescriptor(globalThis,'getComputedStyle');

  Object.defineProperty(globalThis,'window',{configurable:true,value:doc.defaultView});
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:MockResizeObserver});
  Object.defineProperty(globalThis,'getComputedStyle',{configurable:true,value:(node:Element)=>{
    if((node.getAttribute('class')??'').split(/\s+/u).includes('card-tags')){
      return {columnGap:`${gapPx}px`,gap:`${gapPx}px`,flexGrow:'0',minWidth:'0px',paddingLeft:'0px',paddingRight:'0px',fontSize:'12px'};
    }
    if(node.getAttribute('data-card-tag-key')){
      return {columnGap:'0px',gap:'0px',flexGrow:'0',minWidth:'0px',paddingLeft:'6px',paddingRight:'6px',fontSize:'12px'};
    }
    return {columnGap:'0px',gap:'0px',flexGrow:'1',minWidth:'0px',paddingLeft:'0px',paddingRight:'0px',fontSize:'12px'};
  }});

  try{
    const {TicketCardFooter}=await import('../../app/pc-admin/src/design/components/TicketCard/TicketCard');
    const rootView=createRoot(container);
    const makeTags=():CardTag[]=>[
      {key:'urge',label:'已催单',tone:'attention'},
      {key:'review',label:'待复核',tone:'review'},
      {key:'substatus',label:'等待中',tone:'neutral'},
      {key:'incomplete',label:'待补位置',tone:'neutral'},
    ];
    const render=(tick:number)=>act(()=>{
      rootView.render(
        <TicketCardFooter
          tags={makeTags()}
          owner={<span>林舟</span>}
          hasOwnerName
          activity={<time>刚刚</time>}
          followUp={<p className="shared-follow-up-summary" data-tick={tick}><span>已安排</span></p>}
        />,
      );
    });

    let unmounted=false;
    try{
      await render(0);
      const tagsDiv=findByClass(container,'card-tags');
      const initialFolded=Number(tagsDiv?.getAttribute('data-folded-tag-count')??'-1');

      // 10 identical parent rerenders with fresh array/JSX identity must keep observer & avoid extra measurements.
      const readsBeforeRerenders=measureRectReads;
      const obsBefore=roObserveCount,discBefore=roDisconnectCount;
      for(let i=1;i<=10;i++)await render(i);
      const rerenderReads=measureRectReads-readsBeforeRerenders;
      const rerenderObsDelta=roObserveCount-obsBefore;
      const rerenderDiscDelta=roDisconnectCount-discBefore;

      // Post-mount font loading completion invalidates cached widths and unfolds when glyphs narrow.
      tagWidth=30;
      await act(async()=>{fontEvents.dispatchEvent(new Event('loadingdone'));});
      const unfoldedAfterFont=Number(tagsDiv?.getAttribute('data-folded-tag-count')??'-1');

      // Zero gap preservation: 4 * 35 = 140 fits in 140 when gap is 0 (would overflow at 4px).
      gapPx=0;rowWidth=140;tagWidth=35;
      await act(async()=>{fontEvents.dispatchEvent(new Event('loadingdone'));});
      const zeroGapFolded=Number(tagsDiv?.getAttribute('data-folded-tag-count')??'-1');

      // Rendered +N badge measurement: tags [50, 30, 50] at gap=0, row=110; initially folds 1 with 27px est,
      // then measures real 40px +1 badge (50+30+40=120 > 110) and refolds 2 (50+40=90 <= 110).
      tagMap.urge=50;tagMap.review=30;tagMap.substatus=50;tagMap.incomplete=50;
      rowWidth=110;overflowBadgeWidth=40;
      await act(async()=>{fontEvents.dispatchEvent(new Event('loadingdone'));});
      const measuredBadgeFolded=Number(tagsDiv?.getAttribute('data-folded-tag-count')??'-1');

      unmounted=true;
      await act(()=>rootView.unmount());
      return {
        initialFolded,
        rerenderReads,
        rerenderObsDelta,
        rerenderDiscDelta,
        unfoldedAfterFont,
        zeroGapFolded,
        measuredBadgeFolded,
        observerCleanedUp:roObserveCount===1&&roDisconnectCount===1,
        fontListenerCleanedUp:fontAddCount===1&&fontRemoveCount===1,
      };
    }finally{
      if(!unmounted)await act(()=>rootView.unmount());
    }
  }finally{
    const restore=(name:string,desc:PropertyDescriptor|undefined)=>{
      if(desc)Object.defineProperty(globalThis,name,desc);else Reflect.deleteProperty(globalThis,name);
    };
    restore('window',origWin);
    restore('document',origDoc);
    restore('ResizeObserver',origRO);
    restore('getComputedStyle',origGCS);
    const restoreProto=(name:string,desc:PropertyDescriptor|undefined)=>{
      if(desc)Object.defineProperty(elemProto,name,desc);else Reflect.deleteProperty(elemProto,name);
    };
    restoreProto('children',origChildren);
    restoreProto('clientWidth',origClientWidth);
    restoreProto('scrollWidth',origScrollWidth);
    restoreProto('querySelector',origQuerySelector);
    restoreProto('getBoundingClientRect',origRect);
  }
}
