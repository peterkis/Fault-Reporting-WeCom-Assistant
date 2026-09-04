import { readFile } from 'node:fs/promises';
import { createWorkbenchStaticHandler } from './p2-006-workbench-static.mjs';
const assets=Object.freeze({'/workbench/lifecycle':['lifecycle.html','text/html'],
  '/static/workbench/lifecycle.js':['lifecycle.js','text/javascript'],'/static/workbench/lifecycle.css':['lifecycle.css','text/css']});
export function createP2016WorkbenchStatic({enabled=false,conversationEnabled=false}) {
  const original=createWorkbenchStaticHandler({enabled:conversationEnabled});
  return async(pathname,response)=>{
    const asset=assets[pathname];if(!asset)return original(pathname,response);
    if(!enabled){response.writeHead(503,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});response.end('P2-016 工作台未启用');return true;}
    const body=await readFile(new URL('../web/p2-workbench/'+asset[0],import.meta.url));
    response.writeHead(200,{'content-type':asset[1]+'; charset=utf-8','cache-control':'no-store'});response.end(body);return true;
  };
}
