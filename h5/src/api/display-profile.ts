import {queryOptions} from '@tanstack/react-query';
import type {H5DisplayProfile} from '../../../contracts/yxx_h5_v2_contracts.js';
import {api,ApiError,request} from './client';
import {record,InvalidResponse} from './decode';

function decode(value:unknown):H5DisplayProfile{
 if(!record(value)||value.schema_version!==1||typeof value.recovery_scope!=='string'||!record(value.profile))throw new InvalidResponse();
 const {name,department}=value.profile;
 if(name!==null&&(typeof name!=='string'||name.length>80)||department!==null&&(typeof department!=='string'||department.length>128))throw new InvalidResponse();
 return {schema_version:1,recovery_scope:value.recovery_scope,profile:{name,department}};
}
/** A separate display cache cannot fill an authority or an entry cache. */
export function displayProfileOptions(scope:string,revision:string){
 return queryOptions({queryKey:['display-profile',scope,revision] as const,queryFn:async({signal})=>{
  const value=await request('/h5/profile',decode,{signal});
  if(value.recovery_scope!==scope){void api.recheckSession().catch(()=>undefined);throw new ApiError(409,'MEMBER_SCOPE_CHANGED');}
  return value.profile;
 },staleTime:30_000,gcTime:120_000,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchOnMount:true});
}
