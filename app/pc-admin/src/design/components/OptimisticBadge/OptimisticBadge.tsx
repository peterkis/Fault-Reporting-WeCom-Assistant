import {LoaderCircle} from 'lucide-react';
import {useDelayedLoading} from '../../hooks/useDelayedLoading';
import './optimistic-badge.css';

export type OptimisticBadgeKind='claim'|'close'|'follow';

export interface OptimisticBadgeProps {
  pending:boolean;
  kind?:OptimisticBadgeKind|undefined;
  label?:string|undefined;
  className?:string|undefined;
}

/**
 * Quiet confirmation badge rendered only after `--load-delay` (150ms) and kept at least `--load-min` (300ms)
 * so fast round-trips feel instant without flicker.
 */
export function OptimisticBadge({pending,kind,label='确认中',className=''}:OptimisticBadgeProps){
  const {visible}=useDelayedLoading(pending);
  if(!visible)return null;
  return (
    <span className={className?'ds-optimistic-badge '+className:'ds-optimistic-badge'} data-optimistic-badge={kind??'pending'}>
      <LoaderCircle size={10} strokeWidth={1.75} aria-hidden="true"/>
      <span>{label}</span>
    </span>
  );
}
