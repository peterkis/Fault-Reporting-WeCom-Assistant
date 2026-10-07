import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { failP2016 } from './p2-016-domain-contracts.mjs';
const UI=/^\/workbench\/app(?:\/(?:items\/(?:ticket|review|intake)\/[0-9a-f-]{36}\/?|))?$/iu;
export function createWeb01WorkbenchStatic({enabled=false}: {enabled?:boolean}={}) {
  return async(pathname: string,response: ServerResponse)=>{
    if(pathname!=='/workbench/app'&&!pathname.startsWith('/workbench/app/'))return false;
    if(!enabled)failP2016('DISABLED',503);
    let file: string,type: string;
    if(UI.test(pathname)){file='index.html';type='text/html';}
    else if(/^\/workbench\/app\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/u.test(pathname)){
      file=pathname.slice('/workbench/app/'.length);type=file.endsWith('.css')?'text/css':'text/javascript';
    }else failP2016('NOT_FOUND',404);
    const root=new URL('../web/admin-workbench/',import.meta.url);
    // Asset membership is pinned by the build's inventory, never an arbitrary file path.
    const inventory: unknown=JSON.parse(await readFile(new URL('asset-inventory.json',root),'utf8'));
    if(!Array.isArray(inventory)||!inventory.every(v=>typeof v==='string')||!inventory.includes(file))failP2016('NOT_FOUND',404);
    const body=await readFile(new URL(file,root));
    response.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store'});response.end(body);return true;
  };
}
