import {useRef,useState} from 'react';
import type {ComponentProps,ReactNode} from 'react';
import {X} from 'lucide-react';
import {FilterSelect} from '../FilterSelect/FilterSelect';
import {Button} from '../Button/Button';
import './filter-chip.css';

type Props=Omit<ComponentProps<typeof FilterSelect>,'label'|'multiple'|'value'|'onChange'> & {label:string;active:boolean;onClear:()=>void;icon?:ReactNode;title?:string|undefined;value:string;onChange:(value:string)=>void};

/** Presentation only: the caller owns the value, default and single-condition reset. */
export function FilterChip({label,active,onClear,icon,title,className='',onOpenChange,...props}:Props){
  const root=useRef<HTMLDivElement>(null),[open,setOpen]=useState(false);
  return <div ref={root} className={'ds-filter-chip ds-board-filter-pill '+className} data-filter-active={active?'true':undefined} data-filter-open={open?'true':undefined} data-filter-disabled={props.isDisabled?'true':undefined} title={title}>
    {icon?<span className="ds-filter-chip-icon ds-board-filter-icon" aria-hidden="true">{icon}</span>:null}
    <FilterSelect {...props} label={<span className="ds-board-filter-label">{label}</span>} onOpenChange={value=>{setOpen(value);onOpenChange?.(value);}}/>
    {active?<Button tone="ghost" isIconOnly size="sm" aria-label={'清除'+label+'筛选'} isDisabled={Boolean(props.isDisabled)} onPress={()=>{onClear();root.current?.querySelector<HTMLElement>('[data-slot=select-trigger]')?.focus();}}><X aria-hidden="true"/></Button>:null}
  </div>;
}
