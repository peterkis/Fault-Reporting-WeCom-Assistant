import {forwardRef,type ComponentProps} from 'react';
import {useHref,useLinkClickHandler,useMatch,useResolvedPath,type To} from 'react-router';

// History, route matching and link handling all use public React Router APIs.
// This SPA preloads its own code/data, so links need no Framework prefetch UI.
export {HashRouter,Navigate,Route,Routes,useLocation,useNavigate,useParams,useSearchParams} from 'react-router';
export type LinkProps=Omit<ComponentProps<'a'>,'href'>&{to:To;replace?:boolean};
export const Link=forwardRef<HTMLAnchorElement,LinkProps>(function Link({to,replace,target,onClick,...props},ref){
 const href=useHref(to),navigate=useLinkClickHandler<HTMLAnchorElement>(to,{...(target===undefined?{}:{target}),...(replace===undefined?{}:{replace})});
 return <a {...props} ref={ref} href={href} target={target} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&!event.currentTarget.hasAttribute('download'))navigate(event);}}/>;
});
export function NavLink({end=false,className,...props}:LinkProps&{end?:boolean}){
 const path=useResolvedPath(props.to),active=useMatch({path:path.pathname,end})!==null;
 return <Link {...props} className={[className,active?'active':''].filter(Boolean).join(' ')} aria-current={active?'page':undefined}/>;
}
