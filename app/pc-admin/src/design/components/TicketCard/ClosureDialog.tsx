import {useId,useState} from 'react';
import type {KeyboardEvent,ReactNode} from 'react';
import {Bell,BellOff,Search,Ticket,TriangleAlert,X} from 'lucide-react';
import type {WorkbenchCard} from '../../../api/client';
import {Button} from '../Button/Button';
import {Modal} from '../Modal/Modal';
import {Tag} from '../Tag/Tag';
import {stagePresentation} from '../../status-map';
import {ClosureReasonOptions,TicketCategoryTile} from './TicketCard';
import {closureReasons,closureSecondaryReasons,closureNotification} from './closure-presentation';
import type {ClosureFormValue} from './closure-presentation';
import type {ClosureReasonCode,ClosureSecondaryReasonCode} from '../../../../../../contracts/unified_closure_contracts';
import './ticket-card.css';

export interface ClosureSearchItem {id:string;number:string;title:string;service:WorkbenchCard['service'];column:WorkbenchCard['column']}
/** Card 29 K3: one combobox. Typing searches; the chosen original stays inside the field with a clear button. */
export function ClosureSearchField({query,selected,items,busy,disabled,message,onQuery,onSelect}:{query:string;selected:{number:string;title:string|null}|null;items:readonly ClosureSearchItem[];busy:boolean;disabled:boolean;message:string;onQuery:(query:string)=>void;onSelect:(item:ClosureSearchItem|null)=>void}){
 const listId=useId(),labelId=useId(),[active,setActive]=useState(-1),[dismissed,setDismissed]=useState(false);
 const open=!selected&&!dismissed&&Boolean(query.trim())&&(items.length>0||Boolean(message)&&!busy);
 const current=active>=0&&active<items.length?active:-1;
 const keyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setDismissed(false);if(!items.length)return;setActive(index=>event.key==='ArrowDown'?(index+1)%items.length:(index<=0?items.length:index)-1);}
  else if(event.key==='Enter'){event.preventDefault();const item=items[current];if(open&&item)onSelect(item);}
  else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setDismissed(true);}
 };
 return <div className="ds-closure-search">
  <span id={labelId} className="ds-closure-search-label">关联原单<span className="ds-closure-optional">（选填）</span></span>
  {selected?<div className="ds-closure-combobox is-selected" data-closure-selected={selected.number}>
   <Ticket aria-hidden="true"/><span className="ds-closure-number">{selected.number}</span>{selected.title?<span className="ds-closure-selected-title" title={selected.title}>{selected.title}</span>:null}
   <span className="sr-only">已关联 {selected.number}</span>
   <Button tone="ghost" isIconOnly className="ds-closure-clear" aria-label="清除关联" isDisabled={disabled} onPress={()=>onSelect(null)}><X aria-hidden="true"/></Button>
  </div>:<div className="ds-closure-combobox">
   <Search aria-hidden="true"/>
   <input role="combobox" aria-label="关联原单（选填）" aria-labelledby={labelId} aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&current>=0?listId+'-'+current:undefined} aria-busy={busy}
    value={query} disabled={disabled} maxLength={128} placeholder="输入工单编号搜索" autoComplete="off" onKeyDown={keyDown} onChange={event=>{setActive(-1);setDismissed(false);onQuery(event.target.value);}}/>
  </div>}
  {open?<ul className="ds-closure-search-results" id={listId} role="listbox" aria-label="可见原单搜索结果">
   {items.length?items.map((item,index)=>{const stage=stagePresentation[item.column];return <li key={item.id} id={listId+'-'+index} role="option" aria-selected={index===current} data-active={index===current||undefined} className="ds-closure-search-option" onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>{if(!disabled)onSelect(item);}}>
    <TicketCategoryTile service={item.service}/><span className="ds-closure-number">{item.number}</span><span className="ds-closure-option-title" title={item.title}>{item.title}</span><Tag tone={stage.tone} className="ds-closure-option-stage">{stage.label}</Tag>
   </li>;}):<li className="ds-closure-search-empty" role="presentation">{message}</li>}
  </ul>:null}
  {!open&&message&&!selected&&!items.length&&!query.trim()?<p role="status">{message}</p>:null}
 </div>;
}

export function ClosureDialog({open,number,title,value,onChange,busy,locked,canSubmit,onClose,onSubmit,search,inProgress,feedback,error,recovery,draft,onDiscard}:{open:boolean;number:string;title:string;value:ClosureFormValue;onChange:(value:ClosureFormValue)=>void;busy:boolean;locked:boolean;canSubmit:boolean;onClose:()=>void;onSubmit:()=>void;search:ReactNode;inProgress:boolean;feedback:ReactNode;error:string|null;recovery:ReactNode;draft?:ReactNode;onDiscard?:(()=>void)|null}){
 const notice=closureNotification(value),titleId=useId(),noteId=useId(),disabled=busy||locked;
 const secondary=<div className="ds-closure-secondary" role="group" aria-label="具体情况"><span className="ds-closure-secondary-title">具体情况 <span aria-hidden="true">*</span></span>
  <ClosureReasonOptions label="具体情况" options={closureSecondaryReasons} value={value.secondary} isDisabled={disabled} onChange={next=>onChange({...value,secondary:next as ClosureSecondaryReasonCode})}/></div>;
 return <Modal.Backdrop isOpen={open} onOpenChange={next=>{if(!next&&!locked)onClose();}} isDismissable={false} isKeyboardDismissDisabled={locked}>
  <Modal.Container className="ds-closure-container"><Modal.Dialog className="ds-closure-dialog detail-cancel-dialog" aria-label="关闭事项" data-workbench-overlay data-workbench-modal data-toast-host>
   <header data-toast-avoid="top"><Modal.Heading id={titleId}>关闭事项</Modal.Heading><Button tone="ghost" isIconOnly aria-label="关闭取消窗口" isDisabled={locked} onPress={onClose}><X size={18}/></Button></header>
   <p className="ds-closure-context"><span className="ds-closure-number">{number}</span> · {title}</p>
   <form aria-label="取消工单" aria-labelledby={titleId} data-waiting-purpose="cancel" onSubmit={event=>{event.preventDefault();onSubmit();}}>
    <div className="ds-closure-field"><span className="ds-closure-field-label">关闭原因 <span aria-hidden="true">*</span></span><ClosureReasonOptions options={closureReasons} value={value.reason} isDisabled={disabled} nested={value.reason==='NOT_IT_SCOPE'?{after:'NOT_IT_SCOPE',content:secondary}:undefined} onChange={reason=>onChange({...value,reason:reason as ClosureReasonCode,secondary:'',duplicate:'',notify:false})}/></div>
    {value.reason==='DUPLICATE'?search:null}
    <label className="ds-closure-field"><span id={noteId} className="ds-closure-field-label">说明{value.reason==='OTHER'?<span aria-hidden="true"> *</span>:<span className="ds-closure-optional">（选填）</span>}</span><textarea aria-label="取消原因" aria-labelledby={noteId} required={value.reason==='OTHER'} value={value.note} maxLength={2000} disabled={disabled} placeholder="补充给同事看的说明…" onChange={event=>onChange({...value,note:event.target.value})}/></label>
    <p className="ds-closure-private">仅内部可见，不会发送给报修人</p>
    {error?<p role="alert" className="ds-closure-error">{error}</p>:null}
    {value.reason?<div className="ds-closure-notice" aria-live="polite" data-closure-notify={notice.notify}>
     {value.reason==='OTHER'?<><label className="ds-closure-notify-choice"><input type="checkbox" aria-label="通知报修人" checked={value.notify} disabled={disabled} onChange={event=>onChange({...value,notify:event.target.checked})}/><strong>通知报修人</strong></label>
      {notice.text?<p data-closure-notification-text>「{notice.text}」</p>:<p className="ds-closure-notice-silent">不会通知报修人</p>}</>
     :<><span className="ds-closure-notice-title">{notice.notify?<Bell aria-hidden="true"/>:<BellOff aria-hidden="true"/>}<strong>{notice.notify?'将通知报修人':'不会通知报修人'}</strong></span>{notice.text?<p data-closure-notification-text>「{notice.text}」</p>:null}</>}
    </div>:null}
    {inProgress?<p className="ds-closure-termination" data-closure-termination><TriangleAlert aria-hidden="true"/>进行中的跟进与提醒将一并终止</p>:null}
    {feedback}{recovery}
    <footer data-toast-avoid="bottom"><div className="ds-closure-draft">{draft}{onDiscard?<>{draft?<span aria-hidden="true" className="ds-closure-draft-separator">·</span>:null}<Button tone="ghost" data-action="discard-cancel-draft" className="ds-closure-discard" onPress={onDiscard}>清空</Button></>:null}</div>
     <div className="ds-closure-actions"><Button type="button" tone="secondary" isDisabled={locked} onPress={onClose}>取消</Button><Button type="submit" tone="primary" isDisabled={!canSubmit||disabled}>确认关闭</Button></div></footer>
   </form>
  </Modal.Dialog></Modal.Container>
 </Modal.Backdrop>;
}
