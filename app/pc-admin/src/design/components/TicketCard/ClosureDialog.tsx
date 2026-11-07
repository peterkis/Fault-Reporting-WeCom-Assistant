import {useId} from 'react';
import type {ReactNode} from 'react';
import {Bell,X} from 'lucide-react';
import {Button} from '../Button/Button';
import {Modal} from '../Modal/Modal';
import {ClosureReasonOptions} from './TicketCard';
import {closureReasons,closureSecondaryReasons,closureNotification} from './closure-presentation';
import type {ClosureFormValue} from './closure-presentation';
import type {ClosureReasonCode,ClosureSecondaryReasonCode} from '../../../../../../contracts/unified_closure_contracts';
import './ticket-card.css';

export function ClosureSearchField({query,selected,items,busy,disabled,message,onQuery,onSearch,onSelect}:{query:string;selected:string;items:readonly {id:string;number:string;title:string}[];busy:boolean;disabled:boolean;message:string;onQuery:(query:string)=>void;onSearch:()=>void;onSelect:(number:string)=>void}){
 return <div className="ds-closure-search"><label>关联原单（选填）<input aria-label="关联原单（选填）" value={query} disabled={disabled} maxLength={128} placeholder="输入原单编号" onChange={event=>onQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(query.trim()&&!disabled)onSearch();}}}/></label>
  <Button tone="secondary" type="button" isDisabled={disabled||busy||!query.trim()} onPress={onSearch}>按编号搜索</Button>
  {selected?<p>已关联 <span className="ds-closure-number">{selected}</span><Button tone="ghost" isDisabled={disabled} onPress={()=>onSelect('')}>清除关联</Button></p>:null}
  <div className="ds-closure-search-results" aria-label="可见原单搜索结果">{items.map(item=><Button key={item.id} tone="ghost" isDisabled={disabled} onPress={()=>onSelect(item.number)}><span className="ds-closure-number">{item.number}</span> · {item.title}</Button>)}</div>
  {message?<p role="status">{message}</p>:null}
 </div>;
}

export function ClosureDialog({open,number,title,value,onChange,busy,locked,canSubmit,onClose,onSubmit,search,inProgress,feedback,error,recovery}:{open:boolean;number:string;title:string;value:ClosureFormValue;onChange:(value:ClosureFormValue)=>void;busy:boolean;locked:boolean;canSubmit:boolean;onClose:()=>void;onSubmit:()=>void;search:ReactNode;inProgress:boolean;feedback:ReactNode;error:string|null;recovery:ReactNode}){
 const notice=closureNotification(value),titleId=useId(),noteId=useId();
 return <Modal.Backdrop isOpen={open} onOpenChange={next=>{if(!next&&!locked)onClose();}} isDismissable={false} isKeyboardDismissDisabled={locked}>
  <Modal.Container><Modal.Dialog className="ds-closure-dialog detail-cancel-dialog" aria-label="关闭事项" data-workbench-overlay>
   <header><Modal.Heading id={titleId}>关闭事项</Modal.Heading><Button tone="ghost" isIconOnly aria-label="关闭取消窗口" isDisabled={locked} onPress={onClose}><X size={18}/></Button></header>
   <p className="ds-closure-context"><span className="ds-closure-number">{number}</span> · {title}</p>
   <form aria-label="取消工单" aria-labelledby={titleId} data-waiting-purpose="cancel" onSubmit={event=>{event.preventDefault();onSubmit();}}>
    <div className="ds-closure-field"><span>关闭原因 <span aria-hidden="true">*</span></span><ClosureReasonOptions options={closureReasons} value={value.reason} isDisabled={busy||locked} onChange={reason=>onChange({...value,reason:reason as ClosureReasonCode,secondary:'',duplicate:'',notify:false})}/></div>
    {value.reason==='NOT_IT_SCOPE'?<div className="ds-closure-secondary"><span>二级原因 *</span><ClosureReasonOptions label="二级原因" options={closureSecondaryReasons} value={value.secondary} isDisabled={busy||locked} onChange={secondary=>onChange({...value,secondary:secondary as ClosureSecondaryReasonCode})}/></div>:null}
    {value.reason==='DUPLICATE'?search:null}
    <label className="ds-closure-field"><span id={noteId}>说明{value.reason==='OTHER'?' *':'（选填）'}</span><textarea aria-label="取消原因" aria-labelledby={noteId} required={value.reason==='OTHER'} value={value.note} maxLength={2000} disabled={busy||locked} onChange={event=>onChange({...value,note:event.target.value})}/></label>
    <p className="ds-closure-private">说明仅供内部查看，不会发送给报修人。</p>
    {error?<p role="alert" className="ds-closure-error">{error}</p>:null}
    <div className="ds-closure-notice" aria-live="polite"><Bell size={16} aria-hidden="true"/><div>
     {value.reason==='OTHER'?<label className="ds-closure-notify-choice"><input type="checkbox" aria-label="通知报修人" checked={value.notify} disabled={busy||locked} onChange={event=>onChange({...value,notify:event.target.checked})}/>通知报修人</label>:null}
     <strong>{notice.notify?'将通知报修人':'不会通知报修人'}</strong>{notice.text?<p data-closure-notification-text>{notice.text}</p>:null}
     {inProgress?<p>进行中的跟进与提醒将一并终止</p>:null}
     <p className="ds-closure-footnote">关闭后不计入完成数，可在『已关闭』中恢复到关闭前所在列。</p>
    </div></div>
    {feedback}{recovery}
    <footer><Button type="button" tone="secondary" isDisabled={locked} onPress={onClose}>取消</Button><Button type="submit" tone="primary" isDisabled={!canSubmit||busy||locked}>确认关闭</Button></footer>
   </form>
  </Modal.Dialog></Modal.Container>
 </Modal.Backdrop>;
}
