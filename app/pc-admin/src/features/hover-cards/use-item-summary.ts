import {useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,type WorkbenchCard} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {clearHoverItemDenied,markHoverItemDenied} from './denied-items';

export interface SummaryItemRef {
  kind:WorkbenchCard['kind'];
  id:string;
}

/** Shared summary detail query for conversation/hover cards; enforces 401/403/404 authority fencing. */
export function useItemSummary({
  principalId,
  item,
  enabled=true,
  onRevoked,
}: {
  principalId:string;
  item:SummaryItemRef|null|undefined;
  enabled?:boolean;
  onRevoked?:()=>void;
}){
  const client=useQueryClient();
  const active=Boolean(item)&&enabled;
  const query=useQuery({
    queryKey:['detail',principalId,item?.kind,item?.id,'summary'],
    queryFn:async({signal})=>{
      if(!item)throw new Error('NO_CANONICAL_ITEM');
      try{
        const detail=await api.detail(item.kind,item.id,null,signal);
        clearHoverItemDenied(principalId,detail.item.kind,detail.item.id,detail.item.number);
        return detail;
      }catch(error){
        if(!signal.aborted&&error instanceof ApiError&&(error.status===403||error.status===404)){
          markHoverItemDenied(principalId,item.kind,item.id,error.status as 403|404);
        }
        throw error;
      }
    },
    enabled:active,
  });

  const denied=query.error instanceof ApiError&&[403,404].includes(query.error.status);

  useEffect(()=>{
    if(!active||!item||!(query.error instanceof ApiError))return;
    if(query.error.status===401){
      void clearSessionAuthorization(client,principalId,401,'revoked');
      return;
    }
    if([403,404].includes(query.error.status)){
      onRevoked?.();
      void clearItemAuthorization(client,principalId,item.kind,item.id,query.error);
    }
  },[active,client,item,onRevoked,principalId,query.error]);

  return {query,denied};
}
