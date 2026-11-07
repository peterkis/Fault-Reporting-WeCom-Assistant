import {ReportCard} from '../components/ReportCard';
import{useState}from'react';
import{Link}from'../navigation';
import{preloadNavigation}from'../routing';
import{useQuery}from'@tanstack/react-query';
import{useTranslation}from"../i18n-react";
import{homeOptions,departmentSummaryOptions}from'../api/query';
import{useIdentity,useSessionStatus}from'../session';
import{useDisplayProfile}from'../hooks/useDisplayProfile';
import{useGreeting}from'../hooks/useGreeting';
import{Icon}from'../components/Icon';
import{formatPhone,safePhone}from'../lib/utils';
import{Button,buttonVariants,Card,CardHeader,CardTitle,CardDescription,CardContent}from'../components/ui/primitives';
import{EmptyReports,ErrorPanel,Loading,SelfCheck}from'../components/Common';
function GreetingHeading({name}:{name:string|null}){const{t}=useTranslation(),key=useGreeting();return <h1>{t(key,{name:name||t('member')})}</h1>;}
export default function Home(){const{t}=useTranslation();const session=useIdentity(),profile=useDisplayProfile(),status=useSessionStatus();const[help,setHelp]=useState(false);
 const reports=useQuery(homeOptions(session.recovery_scope));
 const department=useQuery({...departmentSummaryOptions(session.recovery_scope,status.membershipRevision),enabled:session.h5.can_view_department});
 const items=reports.data??[];const empty=reports.isSuccess&&items.length===0;
 const emergencyPhone=safePhone(session.h5.support.emergency_phone),servicePhone=safePhone(session.h5.support.service_phone);
 const emergencyContent=<><span className="utility-icon utility-blue"><Icon name="call"/></span><strong>{t('emergency')}</strong><small>{formatPhone(session.h5.support.emergency_phone)}</small></>,serviceContent=<><span className="utility-icon utility-red"><Icon name="support_agent"/></span><strong>{t('servicePhone')}</strong><small>{formatPhone(session.h5.support.service_phone)}</small></>;
 return <div className={'home-page'+(empty?' home-empty':'')}><div className="greeting"><div><GreetingHeading name={profile.name}/><p>{profile.department||t('departmentUnknown')}</p></div><div className="greeting-end"><Icon name="stethoscope"/></div></div><Card className="hero-card"><CardHeader><div className="eyebrow"><span className="status-dot"/>{t('heroEyebrow')}</div><CardTitle>{t('heroTitle')}</CardTitle><CardDescription>{t('heroDescription')}</CardDescription></CardHeader><CardContent><Link to="/report" data-slot="button" className={buttonVariants({size:"lg",className:"w-full"})} aria-disabled={!session.can_submit||undefined} tabIndex={session.can_submit?undefined:-1} onClick={event=>{if(!session.can_submit)event.preventDefault();}} onPointerEnter={()=>preloadNavigation('/report')} onFocus={()=>preloadNavigation('/report')}><Icon name="bolt" data-icon="inline-start"/>{t('heroCta')}</Link></CardContent></Card><section className="support-section"><h2>{t('support')}</h2><div className="support-grid">{emergencyPhone?<a href={emergencyPhone}>{emergencyContent}</a>:<div className="support-phone">{emergencyContent}</div>}{servicePhone?<a href={servicePhone}>{serviceContent}</a>:<div className="support-phone">{serviceContent}</div>}<Button variant="ghost" className="support-button" data-h5-action="self-check" onClick={()=>setHelp(true)}><span className="utility-icon utility-orange"><Icon name="lightbulb"/></span><strong>{t('selfCheck')}</strong><small>{t('selfCheckShort')}</small></Button></div></section>{session.h5.can_view_department&&<Link to="/department" className="department-strip"><span className="utility-icon"><Icon name="dns"/></span><div><strong>{profile.department&&<>{profile.department} · </>}{t('departmentTickets')}</strong><small>{department.data?t('departmentStats',{total:department.data.total,active:department.data.active_count}):department.isPending?<Loading/>:t('notAvailable')}</small></div><span className="text-link">{t('detail')}<Icon name="chevron_right"/></span></Link>}<section className="recent-section"><div className="section-heading"><h2>{t('recent')}</h2><Link to="/reports" className="text-link">{t(empty?'history':'allHistory')}<Icon name="chevron_right"/></Link></div>{reports.isPending?<Loading/>:reports.isError?<ErrorPanel error={reports.error} retry={()=>void status.refresh().catch(()=>undefined)}/>:items.length?<div className="report-list">{items.map(item=><ReportCard key={item.kind+item.ref} item={item}/>)}</div>:<EmptyReports/>}</section><SelfCheck open={help} onOpenChange={setHelp}/></div>;
}
