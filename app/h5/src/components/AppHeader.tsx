import {lazy,memo,Suspense,useState} from 'react';
import {useTranslation} from "../i18n-react";
import {Link,useLocation,useNavigate} from '../navigation';
import {Icon} from './Icon';
import {LazyPanelBoundary} from './LazyPanelBoundary';
import {Button,Badge} from './ui/primitives';

const ProfileDialog=lazy(()=>import('./ProfileDialog'));
function PrimaryTools(){
 const{t}=useTranslation(),navigate=useNavigate();const[profile,setProfile]=useState(false);
 return <><div className="header-tools"><Button variant="ghost" size="icon" onClick={()=>navigate('/reports')} aria-label={t('search')}><Icon name="search"/></Button><Button variant="secondary" size="icon" data-h5-action="profile" onClick={()=>setProfile(true)} aria-label={t('profile')}><Icon name="person"/></Button></div>{profile&&<LazyPanelBoundary onClose={()=>setProfile(false)}><Suspense fallback={null}><ProfileDialog open={profile} onOpenChange={setProfile}/></Suspense></LazyPanelBoundary>}</>;
}
/** One persistent header owns the shared geometry; request pages omit tools. */
export const AppHeader=memo(function AppHeader(){
 const{t}=useTranslation(),location=useLocation(),navigate=useNavigate(),detail=location.pathname.startsWith('/requests/');
 return <header className="app-header"><div className="header-inner">{detail?<div className="detail-header-main"><Button variant="ghost" size="icon" onClick={()=>navigate('/reports')} aria-label={t('back')}><Icon name="arrow_back"/></Button><Link to="/" className="brand-mark" aria-label={t('home')}>修</Link><div className="detail-header-title"><h1>{t('detailTracking')}</h1><Badge variant="blue"><Link to="/">{t('app')}</Link></Badge></div></div>:<Link to="/" className="brand"><span className="brand-mark">修</span><span className="brand-copy"><span className="brand-title">{t('app')}<Badge variant="success">{t('online')}</Badge></span><span className="brand-location"><Icon name="location_on"/>{t('campus')}</span></span></Link>}{!detail&&<PrimaryTools/>}</div></header>;
});
