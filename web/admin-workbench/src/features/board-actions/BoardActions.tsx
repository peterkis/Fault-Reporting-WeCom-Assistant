import {createContext,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {DragDropProvider,useDraggable,useDroppable} from '@dnd-kit/react';
import {Feedback} from '@dnd-kit/dom';
import {api,ApiError,captureWorkbenchRead,errorMessage} from '../../api/client';
import type {Principal,WorkbenchCard,BoardColumn} from '../../api/client';
import {reviewApi} from '../manual-review/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import type {WorkbenchBoardActionIntent} from '../../../../../contracts/workbench_board_action_intent_contracts';
import {boardColumnNames,boardColumns,planBoardAction,readBoardIntent} from './intent';
import './board-actions.css';

type Entry={intent:WorkbenchBoardActionIntent;selector:string};
const BoardActionsContext=createContext<{enabled:boolean;blocked:boolean;open:(intent:WorkbenchBoardActionIntent)=>void}>({enabled:false,blocked:true,open:()=>{}});
export function BoardActions({principal,blocked,selectionKey,onOpen,children}:{principal:Principal;blocked:boolean;selectionKey:string;onOpen:(entry:Entry)=>void;children:ReactNode}){
  const client=useQueryClient(),enabled=principal.board_actions_enabled===true,request=useRef<AbortController|null>(null),generation=useRef(0),captured=useRef<{kind:WorkbenchCard['kind'];id:string;column:BoardColumn}|null>(null),focus=useRef<HTMLElement|null>(null);
  const [checking,setChecking]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>()=>{generation.current++;request.current?.abort();request.current=null;captured.current=null;setChecking(false);setMessage('');},[principal.principal_id,principal.authorization_revision,enabled,selectionKey]);
  const open=async(intent:WorkbenchBoardActionIntent)=>{
    if(!enabled||blocked||request.current)return;
    const plan=planBoardAction(intent);
    if(plan.state==='NO_CHANGE'){setMessage('列内顺序由官方查询决定，未保存手工排序。');return;}
    if(plan.state==='UNAVAILABLE'){setMessage('此落点不能执行合法业务动作，当前位置未作本地变更。');return;}
    const controller=new AbortController(),token=++generation.current,currentRead=captureWorkbenchRead(controller.signal);request.current=controller;setChecking(true);setMessage('正在核验原事项及当前合法动作…');
    const current=()=>{if(controller.signal.aborted||generation.current!==token)return false;try{currentRead();return true;}catch{return false;}};
    let sessionRead=true;
    try{
      const fresh=await api.bootstrap(controller.signal);if(!current())return;
      sessionRead=false;
      client.setQueryData(['session'],fresh);
      if(fresh.principal_id!==principal.principal_id)throw new ApiError(401,'AUTHORIZATION_REJECTED');
      if(!fresh.board_actions_enabled){setMessage('拖动入口已关闭；原表单、输入及未确认操作继续保留。');return;}
      const detail=await api.detail(intent.kind,intent.id,null,controller.signal);if(!current())return;
      if(detail.item.column!==intent.source_column){setMessage('事项的当前状态已变化，请按官方查询重新选择操作。');return;}
      let selector='';
      const needsReview=plan.action==='REVIEW_RESOLVE_AND_START'||plan.action==='SELF_HANDLE'&&detail.review_refs?.some(ref=>ref.status==='PENDING');
      if(needsReview){
        if(!fresh.manual_review_enabled||!fresh.manual_review_resolve_and_start_enabled)throw new ApiError(409,'NO_CURRENT_ACTION');
        if(intent.kind==='review'){
          const review=await reviewApi.detail(intent.id,controller.signal);if(!current())return;
          if(!review.allowed_resolutions.includes('CONFIRM_TICKET_ELIGIBLE'))throw new ApiError(409,'NO_CURRENT_ACTION');
        }else if(!detail.review_refs?.some(ref=>ref.status==='PENDING'))throw new ApiError(409,'NO_CURRENT_ACTION');
        selector='[data-review-workspace]';
      }else{
        if(detail.item.kind!=='ticket')throw new ApiError(409,'NO_CURRENT_ACTION');
        const ticket=await api.ticketCommandContext(detail.item.id,controller.signal);if(!current())return;
        if(plan.action==='SELF_HANDLE'){
          if(fresh.ticket_conversation_self_handling_enabled&&ticket.allowed_actions.includes('take-and-start-with-conversations'))selector='.ticket-conversation-handling';
          else if(fresh.ticket_self_handling_enabled&&ticket.allowed_actions.includes('take-and-start'))selector='.ticket-self-handling';
          else if(fresh.ticket_takeover_enabled&&ticket.allowed_actions.includes('takeover-and-start'))selector='.ticket-takeover';
        }else if(plan.action==='STAFF_COMPLETE'){
          if(fresh.ticket_staff_completion_enabled&&ticket.allowed_actions.includes('complete'))selector='.ticket-completion';
          else if(fresh.ticket_takeover_completion_enabled){const targets=await api.takeoverCompletionTargets(detail.item.id,null,controller.signal);if(!current())return;if(targets.allowed_actions.includes('takeover-and-complete'))selector='.ticket-takeover-completion';}
        }else if(fresh.ticket_reopen_rounds_enabled&&ticket.allowed_actions.includes('reopen'))selector='.ticket-reopen';
        if(!selector)throw new ApiError(409,'NO_CURRENT_ACTION');
      }
      if(current()){setMessage('已打开原合法表单；明确提交并读取官方结果前，不移动事项。');onOpen({intent,selector});}
    }catch(error){
      if(!current())return;
      if(error instanceof ApiError){
        if(error.status===401||sessionRead&&[403,404].includes(error.status))await clearSessionAuthorization(client,principal.principal_id,error.status===401?401:error.status===403?403:undefined,'revoked');
        else if(!sessionRead&&[403,404].includes(error.status))await clearItemAuthorization(client,principal.principal_id,intent.kind,intent.id,error);
      }
      if(current())setMessage(error instanceof ApiError&&error.status===409?'当前没有适用此落点的合法动作，请读取当前事实后重新选择。':errorMessage(error));
    }
    finally{if(request.current===controller){request.current=null;setChecking(false);}}
  };
  const disabled=blocked||checking||!enabled;
  // Keep original business controllers at the same React tree position. Only
  // drag capabilities may close; UNKNOWN commands and unsaved inputs may not.
  return <BoardActionsContext.Provider value={{enabled,blocked:disabled,open:intent=>{void open(intent);}}}>
    <DragDropProvider {...(!enabled?{sensors:[],plugins:[],modifiers:[]}:{})} onBeforeDragStart={event=>{if(disabled)event.preventDefault();}}
      onDragStart={({operation})=>{
        const data:unknown=operation.source?.data;
        const value=readBoardIntent(data);captured.current=value?{kind:value.kind,id:value.id,column:value.source_column}:null;
        focus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
      }}
      onDragEnd={event=>{
        const original=captured.current;captured.current=null;
        if(event.canceled){setMessage('已取消拖动，未提交业务操作。');if(focus.current?.isConnected)focus.current.focus();return;}
        const target=event.operation.target?.id;
        if(!original||!boardColumns.some(column=>column===target)){setMessage('请使用合法业务列；当前位置未作本地变更。');return;}
        const intent=readBoardIntent({kind:original.kind,id:original.id,source_column:original.column,target_column:target});if(intent)void open(intent);
      }}>{children}</DragDropProvider>
    {enabled&&message?<p className="board-action-status" role="status" aria-live="polite" data-board-action-status>{message}</p>:null}
  </BoardActionsContext.Provider>;
}
export function BoardActionCard({item,children}:{item:WorkbenchCard;children:ReactNode}){
  const context=useContext(BoardActionsContext);
  return context.enabled?<EnabledBoardActionCard item={item}>{children}</EnabledBoardActionCard>:<>{children}</>;
}
function EnabledBoardActionCard({item,children}:{item:WorkbenchCard;children:ReactNode}){
  const context=useContext(BoardActionsContext),[menu,setMenu]=useState(false),menuButton=useRef<HTMLButtonElement|null>(null);
  const {ref,handleRef,isDragging}=useDraggable({id:'item:'+item.kind+':'+item.id,disabled:context.blocked,plugins:[Feedback.configure({feedback:'none',dropAnimation:null})],data:{kind:item.kind,id:item.id,source_column:item.column,target_column:item.column}});
  return <div ref={ref} className={'board-action-card'+(isDragging?' is-dragging':'')}>
    {children}
    {context.enabled?<div className="board-action-tools">
      <button ref={handleRef} type="button" data-action="board-drag-handle" disabled={context.blocked} aria-label={'拖动 '+item.number+' 发起业务动作'} title="仅此手柄启动拖动；也可使用右侧业务动作按钮">移动</button>
      <button type="button" ref={menuButton} data-action="board-action-menu" disabled={context.blocked} aria-expanded={menu} onClick={()=>setMenu(value=>!value)}>业务动作</button>
      {menu?<div className="board-action-options" role="group" aria-label={item.number+' 的业务列'} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setMenu(false);menuButton.current?.focus();}}}>
        {boardColumns.filter(target=>target!==item.column).map(target=><button key={target} type="button" disabled={context.blocked} data-board-action-target={target} onClick={()=>{setMenu(false);menuButton.current?.focus();context.open({kind:item.kind,id:item.id,source_column:item.column,target_column:target});}}>移至{boardColumnNames[target]}：打开合法表单</button>)}
        <button type="button" onClick={()=>{setMenu(false);menuButton.current?.focus();}}>取消</button>
      </div>:null}
    </div>:null}
  </div>;
}
export function BoardDropColumn({column,children}:{column:BoardColumn;children:ReactNode}){
  const context=useContext(BoardActionsContext);
  return context.enabled?<EnabledBoardDropColumn column={column}>{children}</EnabledBoardDropColumn>:<>{children}</>;
}
function EnabledBoardDropColumn({column,children}:{column:BoardColumn;children:ReactNode}){
  const context=useContext(BoardActionsContext),{ref,isDropTarget}=useDroppable({id:column,disabled:context.blocked});
  return <div ref={ref} data-board-drop-column={column} className={'board-drop-column'+(isDropTarget?' is-drop-target':'')}>{children}</div>;
}
/** Cancel closes only this presentation intent; the existing form/controller stays mounted. */
export function BoardActionNotice({intent,selector,onCancel}:{intent:WorkbenchBoardActionIntent;selector:string;onCancel:()=>void}){
  const container=useRef<HTMLElement|null>(null);
  return <section ref={container} className="board-action-notice" data-board-intent-panel>
    <h3>移至{boardColumnNames[intent.target_column]}：请完成合法表单</h3>
    <p>尚未因拖动提交操作。取消此入口会保留本页输入；结果未知或冲突时，沿原操作核对并以官方查询显示真实位置。</p>
    <button type="button" data-action="focus-board-action-form" onClick={()=>{const root=container.current?.closest('.detail-dialog,.detail-page'),form=root?.querySelector<HTMLElement>(selector);if(form){form.tabIndex=-1;form.scrollIntoView({block:'nearest',behavior:'auto'});form.focus({preventScroll:true});}}}>继续填写原表单</button>
    <button type="button" data-action="cancel-board-move" onClick={onCancel}>取消移动，保留本页输入</button>
  </section>;
}
