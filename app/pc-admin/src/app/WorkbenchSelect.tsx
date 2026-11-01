import {Label,ListBox,Select} from '@heroui/react';
import type {ComponentProps,ReactNode} from 'react';

type Props=Omit<ComponentProps<typeof Select>,'children'|'value'|'onChange'|'selectionMode'|'className'> & {
  label:ReactNode;
  children:ComponentProps<typeof ListBox>['children']; className?:string; inlinePrefix?:boolean;
} & ({multiple?:false;value:string;onChange:(value:string)=>void}|{multiple:true;value:string[];onChange:(value:string[])=>void});

/** Shared composition only; every selection stays owned by its existing controller. */
export function WorkbenchSelect({label,value,onChange,children,className,multiple,inlinePrefix=false,...props}:Props){
  return <Select {...props} data-field-label={props['aria-label']} className={'workbench-select '+(className??'')} selectionMode={multiple?'multiple':'single'} value={value} onChange={key=>{if(multiple){if(Array.isArray(key))onChange(key.filter((item):item is string=>typeof item==='string'));}else if(typeof key==='string')onChange(key);}}>
    <Label>{label}</Label><Select.Trigger>{inlinePrefix?<span className="ds-filter-prefix" aria-hidden="true">{label}：</span>:null}<Select.Value/><Select.Indicator/></Select.Trigger>
    <Select.Popover className="workbench-select-popover"><ListBox>{children}</ListBox></Select.Popover>
  </Select>;
}
