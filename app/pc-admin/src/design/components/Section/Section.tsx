import {Disclosure} from '@heroui/react';
import type {ComponentProps,HTMLAttributes,ReactNode} from 'react';
import {Button} from '../Button/Button';
import './section.css';

type Props=Omit<HTMLAttributes<HTMLElement>,'title'|'style'> & {title:ReactNode;actions?:ReactNode;headingClassName?:string;titleClassName?:string};
export function Section({title,actions,children,className='',headingClassName='',titleClassName='',...props}:Props){
  return <section {...props} className={'ds-section '+className}><header className={'ds-section-heading '+headingClassName}><h3 className={titleClassName}>{title}</h3>{actions}</header>{children}</section>;
}
export function CollapsibleSection({title,children,className='',...props}:Omit<ComponentProps<typeof Disclosure>,'title'|'className'|'children'|'style'>&{title:ReactNode;children:ReactNode;className?:string}){
  return <Disclosure {...props} className={'ds-section workbench-disclosure '+className}>
    <Disclosure.Heading><Button tone="ghost" slot="trigger" className="workbench-disclosure-trigger ds-section-trigger"><Disclosure.Indicator/>{title}</Button></Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body>{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>;
}
