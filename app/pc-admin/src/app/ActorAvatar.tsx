import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Avatar} from '@heroui/react/avatar';
import {ApiError,captureWorkbenchRead} from '../api/client';
import type {Principal,WorkbenchCard} from '../api/client';
import type {ActivityActorColor} from './activity-actors.mjs';
import {isWorkbenchVisible} from '../desktop/host';

async function readAvatar(item:WorkbenchCard,actor:string,signal:AbortSignal){
  const current=captureWorkbenchRead(signal),response=await fetch('/api/workbench/items/'+item.kind+'/'+item.id+'/actor-avatars/'+actor,{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  current();if(response.status===204)return null;
  if(!response.ok)throw new ApiError(response.status,'ACTOR_AVATAR_UNAVAILABLE');
  if(response.headers.get('content-type')!=='image/webp'||Number(response.headers.get('content-length'))>32768)throw new ApiError(502,'ACTOR_AVATAR_INVALID');
  const blob=await response.blob();current();if(!blob.size||blob.size>32768)throw new ApiError(502,'ACTOR_AVATAR_INVALID');return blob;
}
export function ActorAvatar({principal,item,actor,name,color}:{principal:Principal;item:WorkbenchCard;actor:string|null|undefined;name:string;color:ActivityActorColor|undefined}){
  const image=useQuery({queryKey:['actor-avatar',principal.principal_id,item.kind,item.id,actor,principal.authorization_revision],queryFn:({signal})=>readAvatar(item,actor!,signal),enabled:Boolean(actor),retry:false,staleTime:300_000,gcTime:60_000,refetchInterval:query=>query.state.data===null&&isWorkbenchVisible()?30_000:false});
  const [url,setUrl]=useState<string>();
  useEffect(()=>{if(!image.data){setUrl(undefined);return;}const value=URL.createObjectURL(image.data);setUrl(value);return()=>URL.revokeObjectURL(value);},[image.data]);
  return <Avatar className="record-avatar" style={color}>{url?<Avatar.Image src={url} alt=""/>:null}<Avatar.Fallback>{Array.from(name)[0]}</Avatar.Fallback></Avatar>;
}
