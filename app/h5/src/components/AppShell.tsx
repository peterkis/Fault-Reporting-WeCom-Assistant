import {lazy,Suspense,type ReactNode} from 'react';
import {NavLink,useLocation} from '../navigation';
import {useTranslation} from "../i18n-react";
import {cn} from '../lib/utils';
import {Icon} from './Icon';
import {AppHeader} from './AppHeader';
import {LazyPanelBoundary} from './LazyPanelBoundary';
import {preloadNavigation} from '../routing';
export {Loading} from './LoadingProgress';
const HelpDialog=lazy(()=>import('./HelpDialog'));
export function SelfCheck({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){return open?<LazyPanelBoundary onClose={()=>onOpenChange(false)}><Suspense fallback={null}><HelpDialog open={open} onOpenChange={onOpenChange}/></Suspense></LazyPanelBoundary>:null;}
export function Shell({children}:{children:ReactNode}){
 const{t}=useTranslation(),location=useLocation(),detail=location.pathname.startsWith('/requests/');
 return <div className={cn('app-shell',location.pathname==='/report'&&'report-shell',detail&&'detail-shell')}><AppHeader/><main id="main-content">{children}</main>{!detail&&<nav className="bottom-nav" aria-label={t('app')}><NavLink to="/" end onPointerDown={()=>preloadNavigation('/')} onFocus={()=>preloadNavigation('/')}><Icon name="dashboard_customize"/><span>{t('home')}</span></NavLink><NavLink to="/report" onPointerDown={()=>preloadNavigation('/report')} onFocus={()=>preloadNavigation('/report')}><Icon name="bolt"/><span>{t('report')}</span></NavLink><NavLink to="/reports" onPointerDown={()=>preloadNavigation('/reports')} onFocus={()=>preloadNavigation('/reports')}><Icon name="receipt_long"/><span>{t('records')}</span></NavLink></nav>}</div>;
}
