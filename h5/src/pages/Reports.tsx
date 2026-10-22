import {ReportCard} from '../components/ReportCard';
import{useMemo,useState,type FormEvent}from'react';
import{useInfiniteQuery}from'@tanstack/react-query';
import{useSearchParams}from'../navigation';
import{useTranslation}from"../i18n-react";
import{reportsOptions,reportStatus,reportSource}from'../api/query';
import type{ReportsFilter}from'../api/types';
import{useIdentity,useSessionStatus}from'../session';
import{Button,Input,Field,FieldGroup,FieldLabel}from'../components/ui/primitives';
import{Icon}from'../components/Icon';
import{EmptyReports,Loading,ErrorPanel}from'../components/Common';
export default function Reports(){const{t}=useTranslation();const session=useIdentity(),status=useSessionStatus();const[params,setParams]=useSearchParams();const q=params.get('search')??'',statusFilter=reportStatus(params.get('status')??''),sourceFilter=reportSource(params.get('source')??'');const filter=useMemo<ReportsFilter>(()=>({q,status:statusFilter,source:sourceFilter}),[q,statusFilter,sourceFilter]);const[text,setText]=useState(q);
 const setFilter=(next:ReportsFilter)=>{const value=new URLSearchParams();if(next.q)value.set('search',next.q);if(next.status)value.set('status',next.status);if(next.source)value.set('source',next.source);setParams(value);};
 const reports=useInfiniteQuery(reportsOptions(session.recovery_scope,filter));
 const items=useMemo(()=>reports.data?.pages.flatMap(page=>page.items)??[],[reports.data?.pages]);
 const search=(event:FormEvent)=>{event.preventDefault();setFilter({...filter,q:text.trim()});};
 return <div className="query-page"><div className="section-heading"><h1>{t('records')}</h1><Button variant="ghost" size="icon" onClick={()=>void status.refresh().catch(()=>undefined)} aria-label={t('refresh')}><Icon name="refresh"/></Button></div><form onSubmit={search}><FieldGroup><Field><FieldLabel htmlFor="report-search" className="sr-only">{t('search')}</FieldLabel><div className="search-row"><Input id="report-search" value={text} onChange={event=>setText(event.target.value)} maxLength={100} placeholder={t('searchPlaceholder')} autoComplete="off"/><Button type="submit" aria-label={t('searchSubmit')}><Icon name="search"/></Button></div></Field><div className="filter-grid"><Field><FieldLabel htmlFor="status-filter">{t('statusLabel')}</FieldLabel><select id="status-filter" value={filter.status} onChange={event=>setFilter({...filter,status:reportStatus(event.target.value)})}><option value="">{t('allStatuses')}</option><option value="OPEN">{t('queued')}</option><option value="ACTIVE">{t('activeStatuses')}</option><option value="COMPLETED">{t('completedStatuses')}</option></select></Field><Field><FieldLabel htmlFor="source-filter">{t('sourceLabel')}</FieldLabel><select id="source-filter" value={filter.source} onChange={event=>setFilter({...filter,source:reportSource(event.target.value)})}><option value="">{t('allSources')}</option><option value="WEB">{t('webSource')}</option><option value="BOT">{t('botSource')}</option></select></Field></div></FieldGroup></form>{reports.isPending?<Loading/>:reports.isError?<ErrorPanel error={reports.error} retry={()=>void status.refresh().catch(()=>undefined)}/>:items.length?<div className="report-list">{items.map(item=><ReportCard key={item.kind+item.ref} item={item}/>)}</div>:<EmptyReports query/>}{reports.hasNextPage&&<Button variant="outline" className="w-full" disabled={reports.isFetchingNextPage} onClick={()=>void reports.fetchNextPage()}>{t(reports.isFetchingNextPage?'loadingMore':'more')}</Button>}</div>;
}
