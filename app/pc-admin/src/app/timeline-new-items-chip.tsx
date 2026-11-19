// TEMPORARY until 36B NewItemsChip merges: replace this module with:
// export {NewItemsChip} from '../design/components/NewItemsChip/NewItemsChip';

export interface NewItemsChipProps {
  count:number;
  direction:'up'|'down';
  noun:string;
  onActivate:()=>void;
  className?:string;
}

/** TEMPORARY until 36B NewItemsChip merges: unstyled, motionless stub matching the 36B contract DOM. */
export function NewItemsChip({count,direction,noun,onActivate,className=''}:NewItemsChipProps){
  const arrow=direction==='down'?'↓':'↑';
  return <div className={className?'ds-new-items-chip-region '+className:'ds-new-items-chip-region'} role="status" data-new-items-chip-region="">
    {count>0?<button type="button" className="ds-new-items-chip" data-new-items-chip="" data-direction={direction} onClick={onActivate}>{`${arrow} ${count} 条新${noun}`}</button>:null}
  </div>;
}
