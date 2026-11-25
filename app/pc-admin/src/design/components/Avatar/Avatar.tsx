import type {ComponentPropsWithRef,ReactNode} from 'react';
import {avatarInitial} from './avatarInitial';
import './avatar.css';

type Props=Omit<ComponentPropsWithRef<'span'>,'style'|'color'> & {name?:string|null;personId?:string|undefined;size?:18|20|24|28|32|36;systemIcon?:ReactNode;imageSrc?:string|undefined};
export function Avatar({name,personId,size=24,systemIcon,imageSrc,className='',...props}:Props){
  let hash=0;
  for(const character of personId??name??'')hash=(hash*31+(character.codePointAt(0)??0))>>>0;
  const color=hash%4+1,unassigned=!name&&!systemIcon;
  const decorative=props['aria-hidden']===true||props['aria-hidden']==='true';
  const label=systemIcon?'系统':name||'未分配';
  return <span role={decorative?undefined:unassigned?'img':undefined} aria-label={decorative?undefined:label} title={label} {...props} data-size={size} data-system={systemIcon?true:undefined} data-unassigned={unassigned?'true':undefined} className={'avatar ds-avatar av'+color+(unassigned?' unassigned':'')+' '+className}>{imageSrc?<img data-slot="avatar-image" src={imageSrc} alt=""/>:unassigned?null:<span data-slot="avatar-fallback" aria-hidden="true">{systemIcon??avatarInitial(name??'')}</span>}</span>;
}
