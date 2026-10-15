import type {WorkbenchSearchRequest} from '../contracts/workbench_search_contracts.js';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {WorkbenchSearchPort} from './workbench-search-port.mjs';
import {parseSearchRequest,SearchInputError} from './workbench-search-contracts.mjs';
import {failP2016} from './p2-016-domain-contracts.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
export function createWorkbenchSearchHttp(search:WorkbenchSearchPort,enabled=false){
 return async({request,response,url,authContext,json}:Context)=>{
  if(url.pathname!=='/api/workbench/search')return false;
  if(!enabled||request.method!=='GET')failP2016('NOT_FOUND',404);
  let input:WorkbenchSearchRequest;try{decodeURIComponent(url.search.replace(/\+/gu,' '));input=parseSearchRequest(url.searchParams);}catch(error){failP2016(error instanceof SearchInputError?error.code:'INPUT_INVALID');}
  try{json(response,200,await search.search({authContext,request:input}));}
  catch(error){if(error instanceof WorkbenchError&&error.status===429){response.setHeader('Retry-After','60');json(response,429,{error:{code:error.code,retryable:true}});return true;}throw error;}
  return true;
 };
}
