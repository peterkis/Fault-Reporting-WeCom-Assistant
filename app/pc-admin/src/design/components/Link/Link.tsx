import type {AnchorHTMLAttributes,ReactNode,Ref} from 'react';

export interface CardLinkRenderProps {
  'data-slot':'link';
  className:string;
  tabIndex:number;
}
export type CardLinkProps=Omit<AnchorHTMLAttributes<HTMLAnchorElement>,'className'> & {
  ref?:Ref<HTMLAnchorElement>;
  className?:string;
  render?:(props:CardLinkRenderProps)=>ReactNode;
};

/** Lightweight design-system link primitive for high-cardinality cards, owning `.link`, `data-slot="link"`, and Safari's explicit `tabIndex={0}` tab-stop fallback. */
export function CardLink({className='',tabIndex=0,render,children,...props}:CardLinkProps){
  const linkProps:CardLinkRenderProps={'data-slot':'link',className:className?'link '+className:'link',tabIndex};
  if(render)return render(linkProps);
  return <a {...props} {...linkProps}>{children}</a>;
}
