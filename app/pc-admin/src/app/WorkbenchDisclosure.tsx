import {Button,Disclosure} from '@heroui/react';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';

export function WorkbenchDisclosure({title,children,className='',forceOpen=false}:{title:ReactNode;children:ReactNode;className?:string;forceOpen?:boolean|undefined}){
  const [expanded,setExpanded]=useState(forceOpen);
  useEffect(()=>{if(forceOpen)setExpanded(true);},[forceOpen]);
  return <Disclosure className={'workbench-disclosure '+className} isExpanded={expanded} onExpandedChange={setExpanded}>
    <Disclosure.Heading><Button variant="ghost" slot="trigger" className="workbench-disclosure-trigger"><Disclosure.Indicator/>{title}</Button></Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body>{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>;
}
