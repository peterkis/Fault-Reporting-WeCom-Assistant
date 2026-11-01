import type {HTMLAttributes,ReactNode} from 'react';
import './property-list.css';

export function PropertyList({children,header,className='',...props}:HTMLAttributes<HTMLElement>&{header?:ReactNode}){
  return <section {...props} className={'properties detail-properties ds-property-list '+className}>{header}<dl>{children}</dl></section>;
}
export function PropertyValue({children}:{children:ReactNode}){
  return children===null||children===undefined||children===''?<span className="ds-property-missing">未提供</span>:<>{children}</>;
}
