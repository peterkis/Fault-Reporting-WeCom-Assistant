import { useQuery } from '@tanstack/react-query';
import type { Principal,WorkbenchCard } from '../api/client';
import { api,statusLabels } from '../api/client';
import { Avatar } from '../design/components/Avatar/Avatar';
import { StatusBadge } from '../design/components/StatusBadge/StatusBadge';
import { Tag } from '../design/components/Tag/Tag';
import { actionPresentation,statusTones } from '../design/status-map';
export function itemLink(item:Pick<WorkbenchCard,'kind'|'id'>,search:string){
  const parameters=new URLSearchParams(search);if(parameters.has('locate')){parameters.delete('locate');search=parameters.size?'?'+parameters:'';}
  return '/items/'+item.kind+'/'+item.id+search;
}

export function Status({item}:{item:WorkbenchCard}){
  return <><StatusBadge className="status-chip" tone={statusTones[item.status]??'neutral'}>{statusLabels[item.status]??'状态待确认'}</StatusBadge>{item.kind==='ticket'&&item.review_reason?<Tag className="status-chip" tone={actionPresentation.review.tone}>待复核</Tag>:null}</>;
}

export function TeamAvatar({name}:{name:string}){
  return <Avatar aria-hidden="true" name={name}/>;
}

export function Owner({name,compact=false}:{name:string|null;compact?:boolean}){
  return <span className="owner">{name?<TeamAvatar name={name}/>:<Avatar aria-hidden="true"/>}<span className="owner-name">{name??(compact?'未领取':'等待领取')}</span></span>;
}

export function useReporterProfile(item:WorkbenchCard,principal:Principal){
  return useQuery({queryKey:['reporter-profile',principal.principal_id,item.kind,item.id,principal.authorization_revision],queryFn:({signal})=>api.reporterProfile(item.kind,item.id,signal),
    enabled:principal.web_reports_enabled===true&&item.source==='PORTAL'&&!item.reporter_name&&!item.reporter_department,staleTime:300_000,gcTime:300_000,retry:false});
}
