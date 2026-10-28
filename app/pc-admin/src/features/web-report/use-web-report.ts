import {useQuery} from '@tanstack/react-query';
import type {Principal} from '../../api/client';
import {webReportApi} from './client';

export function useWebReport(principal:Principal,kind:'ticket'|'review'|'intake',id:string,readReady:boolean){
  return useQuery({queryKey:['web-report',principal.principal_id,kind,id],enabled:readReady&&principal.web_reports_enabled===true,retry:false,gcTime:0,queryFn:({signal})=>webReportApi.view(kind,id,signal)});
}
export type WebReportQuery=ReturnType<typeof useWebReport>;
