import type {createWorkbenchReminders} from './workbench-reminders.mjs';
import type {createWorkbenchFollow} from './workbench-follow.mjs';
import {followCommand} from './workbench-follow.mjs';
import type { WorkbenchHttpOptions } from './p2-006-workbench-http.mjs';
import type { createWeb01WorkbenchQuery } from './web01-workbench-query.mjs';
import { failP2016 } from './p2-016-domain-contracts.mjs';
import type {createWorkbenchSourceGroups} from './workbench-source-groups.mjs';
import {sourceGroupNameCommand} from './workbench-source-groups.mjs';
type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
export function createWeb01WorkbenchHttp(query: ReturnType<typeof createWeb01WorkbenchQuery>,sourceGroups:ReturnType<typeof createWorkbenchSourceGroups>|null=null,workbenchFollowEnabled=false,follow:ReturnType<typeof createWorkbenchFollow>|null=null,reminders:ReturnType<typeof createWorkbenchReminders>|null=null) {
  return async({request,response,url,authContext,json,readJson,validateWriteRequest}: Context)=>{
    if(url.pathname==='/api/workbench/reminders'){
      if(!reminders)failP2016('DISABLED',503);
      if(request.method!=='GET')failP2016('NOT_FOUND',404);
      json(response,200,await reminders.page({authContext,parameters:url.searchParams}));return true;
    }
    if(url.pathname==='/api/workbench/source-groups'||url.pathname.startsWith('/api/workbench/source-groups/')){
      if(!sourceGroups)failP2016('DISABLED',503);
      if(request.method==='GET'&&url.pathname==='/api/workbench/source-groups'){
        if([...url.searchParams.keys()].some(k=>!['cursor','limit','q'].includes(k))||['cursor','limit','q'].some(k=>url.searchParams.getAll(k).length>1))failP2016();
        json(response,200,await sourceGroups.list({authContext,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit'),q:url.searchParams.get('q')}));return true;
      }
      const name=/^\/api\/workbench\/source-groups\/([a-f0-9]{64})\/name$/u.exec(url.pathname);
      if(request.method==='POST'&&name){
        if(url.searchParams.size)failP2016();
        const body=await readJson(request),command=sourceGroupNameCommand(body);
        validateWriteRequest(request,authContext,body,{sessionMutation:false});
        if(request.headers['if-match']!=='"'+command.expected_row_version+'"')failP2016('VERSION_CONFLICT',409);
        json(response,200,await sourceGroups.save({authContext,ref:name[1],body:command}));return true;
      }
      failP2016('NOT_FOUND',404);
    }
    if(!url.pathname.startsWith('/api/workbench/board')&&!url.pathname.startsWith('/api/workbench/items/'))return false;
    const followRoute=/^\/api\/workbench\/items\/(ticket|review|intake)\/([0-9a-f-]{36})\/follow(?:\/commands\/([0-9a-f-]{36}))?$/iu.exec(url.pathname);
    if(followRoute){
      if(!workbenchFollowEnabled||!follow)failP2016('NOT_FOUND',404);if(url.searchParams.size)failP2016();
      const kind=followRoute[1],id=followRoute[2];if(!kind||!id)failP2016();
      if(request.method==='GET'&&followRoute[3]){json(response,200,await follow.receipt({authContext,kind,id,commandId:followRoute[3]}));return true;}
      if(request.method!=='POST'||followRoute[3])failP2016('NOT_FOUND',404);
      const raw=await readJson(request),body=followCommand(raw);validateWriteRequest(request,authContext,raw,{sessionMutation:false});
      if(request.headers['if-match']!=='"'+body.expected_follow_version+'"')failP2016('VERSION_CONFLICT',409);
      json(response,200,await follow.save({authContext,kind,id,body}));return true;
    }
    if(request.method!=='GET')failP2016('NOT_FOUND',404);
    const allowed=url.pathname==='/api/workbench/board'?['column','range','closed_from','closed_to','cursor','limit',...(workbenchFollowEnabled?['scope']:[])]:['cursor','limit'];
    if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>url.searchParams.getAll(k).length>1))failP2016();
    const cursor=url.searchParams.get('cursor'),limit=url.searchParams.get('limit');
    if(url.pathname==='/api/workbench/board'){
      const scope=url.searchParams.get('scope');
      if(scope!==null&&scope!=='team'&&scope!=='related')failP2016();
      json(response,200,await query.list({authContext,column:url.searchParams.get('column'),range:url.searchParams.get('range'),closedFrom:url.searchParams.get('closed_from'),closedTo:url.searchParams.get('closed_to'),...(workbenchFollowEnabled?{scope}:{}),cursor,limit}));return true;
    }
    const match=/^\/api\/workbench\/items\/(ticket|review|intake)\/([0-9a-f-]{36})$/iu.exec(url.pathname);
    if(!match||!match[1])failP2016('NOT_FOUND',404);
    json(response,200,await query.detail({authContext,kind:match[1],id:match[2],cursor,limit}));return true;
  };
}
