import {Copy} from 'lucide-react';
import {Button as HButton} from '../design/components/Button/Button';

/**
 * Card 34C: facts that only help troubleshooting (the original operation number, the version a form was filled against) stay out
 * of the visible copy. They are copied on request, and kept on `data-diagnostics` so tests and support can still read them.
 */
export function DiagnosticCopy({data}:{data:Record<string,unknown>}){
  const text=JSON.stringify(data,null,2);
  return <HButton type="button" data-action="copy-diagnostics" data-diagnostics={text} tone="ghost" onClick={()=>{void navigator.clipboard?.writeText(text).catch(()=>{});}}><Copy aria-hidden="true"/>复制诊断信息</HButton>;
}
