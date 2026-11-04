import type {HTMLAttributes,ReactNode} from 'react';
import {avatarInitial} from './avatarInitial';
import './avatar.css';

type Props=Omit<HTMLAttributes<HTMLSpanElement>,'style'|'color'> & {name?:string|null;personId?:string|undefined;size?:20|24|32;systemIcon?:ReactNode;imageSrc?:string|undefined};
export function Avatar({name,personId,size=24,systemIcon,imageSrc,className='',...props}:Props){
  let hash=0;
  for(const character of personId??name??'')hash=(hash*31+(character.codePointAt(0)??0))>>>0;
  const color=hash%4+1,unassigned=!name&&!systemIcon;
  return <span aria-label={systemIcon?'系统':name||'未派单'} title={systemIcon?'系统':name||'未派单'} {...props} data-size={size} data-system={systemIcon?true:undefined} className={'avatar ds-avatar av'+color+(unassigned?' unassigned':'')+' '+className}>{imageSrc?<img data-slot="avatar-image" src={imageSrc} alt=""/>:<span data-slot="avatar-fallback">{systemIcon??avatarInitial(name??'')}</span>}</span>;
}
