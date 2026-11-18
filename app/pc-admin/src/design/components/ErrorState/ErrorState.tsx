import {useState} from 'react';
import {CircleX,Copy} from 'lucide-react';
import toast from 'react-hot-toast/headless';
import {Button} from '../Button/Button';
import {InlineAlert} from '../InlineAlert/InlineAlert';
import './error-state.css';

export interface ReadDiagnostics {requestId:string;requestIdSource:'response'|'local'|'unavailable';time:string;code:string;route:string}
/** No response body, query string, credential, or operator input is included. */
export function readDiagnostics(error:unknown,time:number):ReadDiagnostics{
  const record=error&&typeof error==='object'?error:null;
  return {requestId:record&&'requestId' in record&&typeof record.requestId==='string'?record.requestId:'unavailable',requestIdSource:record&&'requestIdSource' in record&&(record.requestIdSource==='response'||record.requestIdSource==='local')?record.requestIdSource:'unavailable',time:new Date(time||Date.now()).toISOString(),code:record&&'code' in record&&typeof record.code==='string'?record.code:'READ_FAILED',route:location.pathname};
}
export function ErrorState({size='block',title,description='请检查网络后重试。',onRetry,diagnostics,titleId,heading='h2'}:{titleId?:string;heading?:'h1'|'h2';size?:'block'|'page';title:string;description?:string;onRetry:()=>void;diagnostics?:ReadDiagnostics}){
  const Heading=heading;
  const [copyFailed,setCopyFailed]=useState(false);
  const copy=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(diagnostics??readDiagnostics(null,Date.now()),null,2));setCopyFailed(false);toast.success('已复制诊断信息');}catch{setCopyFailed(true);}};
  return size==='block'?<div className="ds-error-state" data-error-size="block"><InlineAlert tone="danger" action={<Button tone="ghost" size="sm" onPress={onRetry}>重试</Button>}>{title}</InlineAlert></div>:<section className="ds-error-state ds-error-page" data-error-size="page" role="alert"><CircleX className="ds-error-icon" aria-hidden="true"/><Heading className="ds-error-heading" id={titleId}>{title}</Heading><p>{description}</p><div className="ds-error-actions"><Button tone="primary" onPress={onRetry}>重试</Button><Button onPress={()=>{void copy();}}><Copy aria-hidden="true"/>复制诊断信息</Button></div>{copyFailed?<p role="status">未能复制，请允许复制后重试。</p>:null}</section>;
}
export function StaleRetry({onRetry}:{onRetry:()=>void}){
  return <span className="ds-stale-retry" role="status"><span>未更新 · </span><Button tone="ghost" size="sm" onPress={onRetry}>重试</Button></span>;
}
