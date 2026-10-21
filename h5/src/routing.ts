import {lazy,type ComponentType} from 'react';
import type {H5EntryInput,H5EntryView} from './api/types';
import {filterInput,reportStatus,reportSource} from './api/query';

type PageModule={default:ComponentType};
/** Explicit paths keep route chunks analyzable by Vite and the startup budget verifier. */
const imports={home:()=>import('./pages/Home'),report:()=>import('./pages/Report'),reports:()=>import('./pages/Reports'),request:()=>import('./pages/Detail'),department:()=>import('./pages/Department')} satisfies Record<H5EntryView,()=>Promise<PageModule>>;
const modules=new Map<H5EntryView,Promise<PageModule>>();
export function loadPage(view:H5EntryView):Promise<PageModule>{let task=modules.get(view);if(!task){task=imports[view]().catch(error=>{modules.delete(view);throw error;});modules.set(view,task);}return task;}
export const pages={home:lazy(()=>loadPage('home')),report:lazy(()=>loadPage('report')),reports:lazy(()=>loadPage('reports')),request:lazy(()=>loadPage('request')),department:lazy(()=>loadPage('department'))} satisfies Record<H5EntryView,ComponentType>;
export interface PageRoute {key:string;input:H5EntryInput;path:string}
export function describeRoute(pathname:string,search=''):PageRoute{
 const params=new URLSearchParams(search);let input:H5EntryInput={view:'home'};
 if(pathname==='/report')input={view:'report'};
 else if(pathname==='/reports')input=filterInput({q:params.get('search')??'',status:reportStatus(params.get('status')??''),source:reportSource(params.get('source')??'')});
 else if(pathname==='/department')input={view:'department'};
 else if(pathname.startsWith('/requests/')){let requestRef='';try{requestRef=decodeURIComponent(pathname.slice('/requests/'.length));}catch{/* The backend remains the authority on invalid references. */}input={view:'request',request_ref:requestRef};}
 else if(pathname==='/'){const ref=new URLSearchParams(location.search).get('request_ref');if(ref)input={view:'request',request_ref:ref};}
 return{key:JSON.stringify(input),input,path:pathname+search};
}
export function initialRoute():PageRoute{
 let path=location.hash.replace(/^#/,'');
 if(!path){const match=/^\/wecom\/yixiaoxiu\/reports(?:\/(new|[A-Za-z0-9_-]{32}))?$/u.exec(location.pathname);if(match){path=match[1]?(match[1]==='new'?'/report':'/requests/'+match[1]):'/reports';window.history.replaceState(window.history.state,'','#'+path);}}
 const url=new URL(path||'/',location.origin);return describeRoute(url.pathname,url.search);
}
export function preloadNavigation(path:string):void{const url=new URL(path,location.origin);void loadPage(describeRoute(url.pathname,url.search).input.view).catch(()=>undefined);}
