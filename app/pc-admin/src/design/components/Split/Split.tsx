import type {HTMLAttributes} from 'react';
import './split.css';
import './conversation-v21.css';

/** Layout only. Callers retain selection, navigation guards and scroll ownership. */
export function Split({className='',...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={'ds-split '+className}/>;}
