import type {HTMLAttributes} from 'react';
import './segmented-control.css';

/** The existing buttons retain their values, handlers, roles and semantic hooks. */
export function SegmentedControl({className='',children,...props}:HTMLAttributes<HTMLDivElement>){
  return <div role="group" {...props} className={'ds-segmented '+className}>{children}</div>;
}
