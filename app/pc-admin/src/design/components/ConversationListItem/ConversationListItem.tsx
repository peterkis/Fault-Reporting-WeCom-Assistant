import type {HTMLAttributes} from 'react';
import {Avatar} from '../Avatar/Avatar';
import './conversation-list-item.css';

export function ConversationListItem({name,personId,className='',children,...props}:HTMLAttributes<HTMLElement>&{name:string;personId?:string}){
 return <article {...props} className={'ds-conversation-list-item '+className}><Avatar name={name.replace(/（[^）]*）/gu,'')} title={name} personId={personId} size={32} aria-hidden="true"/>{children}</article>;
}
