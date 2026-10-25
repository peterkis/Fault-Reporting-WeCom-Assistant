import {useState} from 'react';
import {useTranslation} from "../i18n-react";
import {api} from '../api/client';
import type {RequestDetail} from '../api/types';
import {useSession,useSessionStatus} from '../session';
import {useCommand} from '../hooks/useCommand';
import {detailReceipt} from '../hooks/detail-command-receipt';
import {useDetailDraftGuard} from '../hooks/useDetailDraftGuard';
import {Icon} from './Icon';
import {RecoveryNotice} from './Common';
import {Button,Textarea,Field,FieldLabel,FieldGroup,FieldDescription} from './ui/primitives';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from './ui/dialog';
export type DetailActionKind='evaluation'|'feedback'|'supplement';
export default function DetailDialogs({kind,value,requestRef,onClose,onCommitted,onRefresh}:{kind:DetailActionKind;value:RequestDetail;requestRef:string;onClose:()=>void;onCommitted:()=>Promise<void>;onRefresh:()=>Promise<void>}){
 const {t}=useTranslation(),session=useSession(),status=useSessionStatus(),command=useCommand();
 const [rating,setRating]=useState(0),[comment,setComment]=useState(''),[text,setText]=useState(''),[formError,setFormError]=useState<string|null>(null);
 useDetailDraftGuard(kind==='supplement'?text.length>0:kind==='evaluation'&&(rating>0||comment.length>0));
 const disabled=command.blocked||command.syncingRequests.includes(requestRef)||!status.writeReady;
 const submit=()=>{
  if(disabled)return;setFormError(null);const id=crypto.randomUUID();
  const success=async()=>{onClose();await onCommitted();};
  if(kind==='evaluation'){
   const context=value.h5.evaluation;
   if(!session.h5.can_evaluate||!context.can_evaluate||context.ticket_version===null||!context.completed_round_ref)return;
   if(!Number.isInteger(rating)||rating<1||rating>5){setFormError(t('ratingRequired'));return;}
   const input={schema_version:1 as const,client_command_id:id,expected_ticket_version:context.ticket_version,completed_round_ref:context.completed_round_ref,rating,comment:comment.trim()||null};
   void command.run({id,requestRef,execute:()=>api.evaluate(requestRef,input,session.csrf_token),recover:()=>api.memberCommand(requestRef,id,'EVALUATION'),confirm:detailReceipt(id,requestRef,'EVALUATION'),success});
  }else if(kind==='feedback'){
   const context=value.feedback_context;if(!context?.can_feedback)return;
   const input={schema_version:1 as const,client_command_id:id,feedback:'STILL_UNRESOLVED' as const,expected_ticket_version:context.ticket_version,completed_round_ref:context.completed_round_ref};
   void command.run({id,requestRef,execute:()=>api.feedback(requestRef,input,session.csrf_token),recover:()=>api.feedbackCommand(requestRef,id),confirm:detailReceipt(id,requestRef,'FEEDBACK',context.completed_round_ref),success});
  }else{
   if(!session.can_supplement||!value.can_supplement||!text.trim())return;
   const input={schema_version:1 as const,client_command_id:id,expected_input_revision:value.input_revision,text:text.trim()};
   void command.run({id,requestRef,execute:()=>api.supplement(requestRef,input,session.csrf_token),recover:()=>api.command(id),confirm:detailReceipt(id,requestRef,'SUPPLEMENT'),success});
  }
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!command.blocked)onClose();}}><DialogContent onEscapeKeyDown={event=>{if(command.blocked)event.preventDefault();}} onPointerDownOutside={event=>{if(command.blocked)event.preventDefault();}}><DialogTitle>{t(kind==='evaluation'?'rateTitle':kind==='feedback'?'feedbackTitle':'supplement')}</DialogTitle><DialogDescription>{t(kind==='evaluation'?'ratingComment':kind==='feedback'?'feedbackHint':'supplementHint')}</DialogDescription>{kind==='evaluation'&&<FieldGroup><fieldset className="rating-fieldset"><legend>{t('ratingLabel')}</legend><div className="rating-options">{[1,2,3,4,5].map(star=><label key={star}><input type="radio" name="rating" value={star} checked={rating===star} disabled={disabled} onChange={()=>setRating(star)}/><Icon name="star" className={star<=rating?'star-selected':''}/><span className="sr-only">{t('rating',{count:star})}</span></label>)}</div></fieldset><Field><FieldLabel htmlFor="evaluation-comment">{t('ratingComment')}</FieldLabel><Textarea id="evaluation-comment" maxLength={200} rows={3} value={comment} disabled={disabled} onChange={event=>setComment(event.target.value)}/><FieldDescription>{comment.length}/200</FieldDescription></Field></FieldGroup>}{kind==='supplement'&&<Field><FieldLabel htmlFor="supplement-text">{t('supplement')}</FieldLabel><Textarea id="supplement-text" rows={4} maxLength={1500} value={text} disabled={disabled} placeholder={t('supplementPlaceholder')} onChange={event=>setText(event.target.value)}/></Field>}{formError&&<p role="alert" className="form-error">{formError}</p>}<RecoveryNotice command={command} onRefresh={onRefresh}/><Button disabled={disabled||(kind==='supplement'&&!text.trim())} onClick={submit}>{t(command.busy?'submitting':kind==='evaluation'?'ratingSubmit':kind==='feedback'?'feedbackSubmit':'sendSupplement')}</Button><DialogClose asChild><Button variant="outline" disabled={command.blocked}>{t('close')}</Button></DialogClose></DialogContent></Dialog>;
}
