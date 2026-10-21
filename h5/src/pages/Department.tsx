import{useMemo}from'react';
import{useInfiniteQuery}from'@tanstack/react-query';
import{useTranslation}from'react-i18next';
import{departmentOptions}from'../api/query';
import{useIdentity,useProfile,useSessionStatus}from'../session';
import{Card,CardHeader,CardTitle,CardContent,CardDescription,Badge,Button,Alert,AlertDescription}from'../components/ui/primitives';
import{Loading,ErrorPanel,EmptyReports}from'../components/Common';
import{reportState,reportTone}from'../lib/report';
export default function Department(){const{t}=useTranslation(),session=useIdentity(),profile=useProfile(),status=useSessionStatus();const query=useInfiniteQuery({...departmentOptions(session.recovery_scope,status.membershipRevision),enabled:session.h5.can_view_department});const items=useMemo(()=>query.data?.pages.flatMap(page=>page.items)??[],[query.data?.pages]);
 return <div className="query-page"><h1>{profile.department} · {t('departmentTickets')}</h1><p className="muted">{t('departmentPrivacy')}</p>{!session.h5.can_view_department?<Alert><AlertDescription>{t('noDepartment')}</AlertDescription></Alert>:query.isPending?<Loading/>:query.isError?<ErrorPanel error={query.error} retry={()=>void status.refresh().catch(()=>undefined)}/>:items.length?<div className="report-list">{items.map(item=>{const status=reportState({ticket:{ticket_no:item.ticket_no,status:item.status},display_status:''});return <Card key={item.ticket_no}><CardHeader><div className="section-heading"><CardTitle>{item.ticket_no}</CardTitle><Badge variant={reportTone(status)}>{t(status)}</Badge></div><CardDescription>{item.service_category||t('reportKind')}</CardDescription></CardHeader>{item.public_progress&&<CardContent><p>{item.public_progress.summary}</p></CardContent>}</Card>;})}</div>:<EmptyReports/>}{query.hasNextPage&&<Button variant="outline" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{t('more')}</Button>}</div>;
}
