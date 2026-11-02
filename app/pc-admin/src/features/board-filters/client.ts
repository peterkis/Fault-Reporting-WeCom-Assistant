import {ApiError,readWorkbench} from '../../api/client';
import type {WorkbenchServiceCatalog} from '../../../../../contracts/web01_workbench_contracts';

function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new ApiError(502,'INVALID_RESPONSE');
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new ApiError(502,'INVALID_RESPONSE');return value;}
export function decodeServiceCatalog(value:unknown):WorkbenchServiceCatalog{
  const v=object(value,['schema_version','catalog_version','categories']);
  if(v.schema_version!==1||!Array.isArray(v.categories)||v.categories.length>200)throw new ApiError(502,'INVALID_RESPONSE');
  const codes=new Set<string>(),domains=new Set<string>();
  const categories=v.categories.map(value=>{
    const c=object(value,['category','category_name_zh','services']),category=text(c.category,64);
    if(domains.has(category)||!Array.isArray(c.services)||!c.services.length||c.services.length>200)throw new ApiError(502,'INVALID_RESPONSE');domains.add(category);
    const services=c.services.map(value=>{const s=object(value,['service_code','name_zh']),service_code=text(s.service_code,64);if(codes.has(service_code)||codes.size>=200)throw new ApiError(502,'INVALID_RESPONSE');codes.add(service_code);return {service_code,name_zh:text(s.name_zh,80)};});
    return {category,category_name_zh:text(c.category_name_zh,80),services};
  });
  return {schema_version:1,catalog_version:text(v.catalog_version,64),categories};
}
export const readServiceCatalog=(signal:AbortSignal)=>readWorkbench('/api/workbench/service-catalog',signal,decodeServiceCatalog);
