import type {ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
export async function botReporterAsset(path:string,response:ServerResponse):Promise<void>{
  const root=new URL('../web/admin-workbench/',import.meta.url);
  const value:unknown=JSON.parse(await readFile(new URL('.vite/manifest.json',root),'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('BOT_ASSET_UNAVAILABLE');
  const manifest=value as Record<string,unknown>,files=new Set<string>(),visited=new Set<string>();
  function entry(name:string):string{
    const raw=manifest[name];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('BOT_ASSET_UNAVAILABLE');
    const item=raw as Record<string,unknown>;
    if(typeof item.file!=='string'||!/^assets\/[A-Za-z0-9_-]+\.js$/u.test(item.file))throw Error('BOT_ASSET_UNAVAILABLE');
    files.add(item.file);if(visited.has(name))return item.file;visited.add(name);if(visited.size>32)throw Error('BOT_ASSET_UNAVAILABLE');
    if(item.imports!==undefined){if(!Array.isArray(item.imports)||item.imports.length>32)throw Error('BOT_ASSET_UNAVAILABLE');for(const child of item.imports){if(typeof child!=='string')throw Error('BOT_ASSET_UNAVAILABLE');entry(child);}}
    return item.file;
  }
  const main=entry('src/bot-feedback.ts');
  if(path==='/reporter/bot-feedback.js'){response.writeHead(302,{location:'/reporter/feedback-assets/'+main});response.end();return;}
  const file=path.slice('/reporter/feedback-assets/'.length);
  if(!files.has(file)){response.writeHead(404,{'content-type':'application/json'});response.end(JSON.stringify({error:{code:'YXX_ENTRY_NOT_FOUND',retryable:false}}));return;}
  const bytes=await readFile(new URL(file,root));response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});response.end(bytes);
}
