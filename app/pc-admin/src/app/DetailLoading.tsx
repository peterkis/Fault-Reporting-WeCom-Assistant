import {BlockSkeleton} from '../design/components/Skeleton/Skeleton';
import {LoaderCircle} from 'lucide-react';
import {useDelayedLoading} from '../design/hooks/useDelayedLoading';

/** Only for a button or a single inline value. Sections use BlockSkeleton. */
export function DetailLoading({label,compact=false,inline=false}:{label:string;compact?:boolean;inline?:boolean}){
  const loading=useDelayedLoading(true);
  if(!compact&&!inline)return loading.visible?<div className="detail-loading ds-block-loading"><BlockSkeleton label={label}/></div>:null;
  return loading.visible?<span className={'detail-loading'+(compact?' is-compact':'')} role="status" aria-live="polite" aria-busy="true"><LoaderCircle aria-hidden="true"/><span>{label}</span></span>:null;
}
