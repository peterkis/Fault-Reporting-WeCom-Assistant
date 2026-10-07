import type { WorkbenchHttpOptions } from './p2-006-workbench-http.mjs';
import type { createWeb01WorkbenchQuery } from './web01-workbench-query.mjs';
import { failP2016 } from './p2-016-domain-contracts.mjs';
type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
export function createWeb01WorkbenchHttp(query: ReturnType<typeof createWeb01WorkbenchQuery>) {
  return async({request,response,url,authContext,json}: Context)=>{
    if(!url.pathname.startsWith('/api/workbench/board')&&!url.pathname.startsWith('/api/workbench/items/'))return false;
    if(request.method!=='GET')failP2016('NOT_FOUND',404);
    const allowed=url.pathname==='/api/workbench/board'?['column','range','cursor','limit']:['cursor','limit'];
    if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>url.searchParams.getAll(k).length>1))failP2016();
    const cursor=url.searchParams.get('cursor'),limit=url.searchParams.get('limit');
    if(url.pathname==='/api/workbench/board'){
      json(response,200,await query.list({authContext,column:url.searchParams.get('column'),range:url.searchParams.get('range'),cursor,limit}));return true;
    }
    const match=/^\/api\/workbench\/items\/(ticket|review|intake)\/([0-9a-f-]{36})$/iu.exec(url.pathname);
    if(!match||!match[1])failP2016('NOT_FOUND',404);
    json(response,200,await query.detail({authContext,kind:match[1],id:match[2],cursor,limit}));return true;
  };
}
