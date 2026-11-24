import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {DOMParser} from '@xmldom/xmldom';
import type {Principal,WorkbenchCard} from '../../app/pc-admin/src/api/client';
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
