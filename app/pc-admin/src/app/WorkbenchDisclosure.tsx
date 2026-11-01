import {Button,Disclosure} from '@heroui/react';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {CollapsibleSection} from '../design/components/Section/Section';

export function WorkbenchDisclosure({title,children,className='',forceOpen=false,section=false}:{title:ReactNode;children:ReactNode;className?:string;forceOpen?:boolean|undefined;section?:boolean}){
  const [expanded,setExpanded]=useState(forceOpen);
  useEffect(()=>{if(forceOpen)setExpanded(true);},[forceOpen]);
  if(section)return <CollapsibleSection title={title} isExpanded={expanded} onExpandedChange={setExpanded} className={className}>{children}</CollapsibleSection>;
  return <Disclosure className={'workbench-disclosure '+className} isExpanded={expanded} onExpandedChange={setExpanded}>
    <Disclosure.Heading><Button variant="ghost" slot="trigger" className="workbench-disclosure-trigger"><Disclosure.Indicator/>{title}</Button></Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body>{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>;
}
