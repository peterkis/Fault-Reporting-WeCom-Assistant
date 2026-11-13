import {useEffect,useState} from 'react';
import {InlineAlert} from '../design/components/InlineAlert/InlineAlert';
import {feedbackTone} from './ToastFeedback';
import type {FeedbackProps} from './ToastFeedback';

// Card 34A: kept apart from ToastFeedback, which the loading shell imports eagerly, so InlineAlert and its stylesheet stay in the
// workbench chunk and the shell keeps a single stylesheet.
/**
 * Card 34A: a dialog's own outcome is shown inside the open dialog as an inline alert, not as a toast. Render it where the toast
 * content used to be; the stable keys (`data-toast-source`, `data-toast-state` and the feature's class) stay on it.
 */
export function DialogAlert({children,source,state,role,title,className='',...attributes}:Omit<FeedbackProps,'enabled'|'persistent'|'revision'|'aria-live'>){
  if(!children)return null;
  const heading=title??null;
  return <InlineAlert {...attributes} tone={feedbackTone(state,role)} className={'workbench-dialog-alert '+className} data-dialog-feedback data-toast-source={source} data-toast-state={state??''}>{heading?<><strong>{heading}</strong> </>:null}{children}</InlineAlert>;
}
/**
 * Card 34A: whether a dialog's outcome should still become a page toast. While the dialog is open it is shown inline; an outcome
 * already shown inline is not repeated as a toast after the dialog closes, but a new one (for example the success that closes the
 * dialog) is.
 */
export function useDialogToast(open:boolean,key:unknown):boolean{
  const [inline,setInline]=useState<unknown>(undefined);
  useEffect(()=>{if(open)setInline(key);},[open,key]);
  return !open&&!(inline!==undefined&&Object.is(inline,key));
}
/** Card 34A: a draft notice (warning or restored) shown inline in the dialog that owns the draft. */
export function DialogDraftAlert({children}:{children:string}){
  const warning=/未知|过期|失败|不可用|无法|未确认|须核对|只能只读/u.test(children);
  return warning||/已恢复/u.test(children)?<DialogAlert source="draft" state={warning?'unknown':undefined}>{children}</DialogAlert>:null;
}
