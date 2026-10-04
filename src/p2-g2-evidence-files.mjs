import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failG2, g2Hash, validateG2Manifest } from './p2-g2-validation-config.mjs';

const entryRoot=fileURLToPath(new URL('../',import.meta.url));
// Match G2_ROOT: staged execution reads and writes facts in the canonical source checkout.
const workspace=path.basename(path.resolve(entryRoot))==='runtime'
  &&path.basename(path.dirname(path.resolve(entryRoot)))==='.build'
  ?path.resolve(entryRoot,'../..'):entryRoot;
export function g2SourceBinding(manifest){const m=validateG2Manifest(manifest);return {run_id:m.run_id,candidate_fingerprint:m.candidate_fingerprint,
  run_mode:m.mode,manifest_binding:g2Hash(JSON.stringify(m))};}
export function g2SourceMatches(packet,manifest){const expected=g2SourceBinding(manifest);return Object.entries(expected).every(([k,v])=>packet?.[k]===v);}
export function writeG2SourceFile(ref,content,{root=workspace}={}){
  if(typeof ref!=='string'||! /^(?:tmp\/p2-g2-[A-Za-z0-9-]+\/|evidence\/p2-g2-)[A-Za-z0-9_./-]+$/u.test(ref)
    ||ref.split('/').some(p=>!p||p==='.'||p==='..'))failG2('SOURCE_PATH_INVALID');
  let location=path.resolve(root);const parts=ref.split('/');
  for(const component of parts.slice(0,-1)){
    location=path.join(location,component);const stat=lstatSync(location);
    if(stat.isSymbolicLink()||!stat.isDirectory())failG2('SOURCE_PATH_INVALID');
  }
  writeFileSync(path.join(location,parts.at(-1)),content,{flag:'wx',mode:0o600});
}
// Evidence references are workspace-relative; all path components are checked.
// In particular, a private run directory cannot redirect a reader to a secret.
export function readG2SourceFile(ref,{root=workspace,sha256=null,maxBytes=64*1024*1024}={}){
  if(typeof ref!=='string'||! /^(?:tmp\/p2-g2-[A-Za-z0-9-]+\/|evidence\/p2-g2-)[A-Za-z0-9_./-]+$/u.test(ref)
    ||ref.split('/').some(p=>!p||p==='.'||p==='..'))failG2('SOURCE_PATH_INVALID');
  let location=path.resolve(root);
  try{
    for(const component of ref.split('/')){location=path.join(location,component);if(lstatSync(location).isSymbolicLink())failG2('SOURCE_PATH_INVALID');}
    const stat=lstatSync(location);if(!stat.isFile()||stat.size>maxBytes)failG2('SOURCE_FILE_INVALID');
    const bytes=readFileSync(location);if(sha256!==null&&g2Hash(bytes)!==sha256)failG2('SOURCE_CHANGED');
    return bytes;
  }catch(e){if(/^P2_G2_/u.test(e?.code??''))throw e;failG2('SOURCE_FILE_INVALID');}
}
export function readG2SourceJson(ref,options){try{return JSON.parse(readG2SourceFile(ref,options).toString('utf8'));}catch(e){if(/^P2_G2_/u.test(e?.code??''))throw e;failG2('SOURCE_FILE_INVALID');}}
export function readG2PacketSource(source,{root=workspace}={}){
  const match=/^(.+\.jsonl):([1-9][0-9]{0,4})$/u.exec(source.ref);
  if(!match)failG2('SOURCE_PATH_INVALID');
  const text=readG2SourceFile(match[1],{root}).toString('utf8');
  if(!text.endsWith('\n'))failG2('SOURCE_FILE_INCOMPLETE');
  const line=text.trimEnd().split('\n')[Number(match[2])-1];
  if(!line||g2Hash(line)!==source.sha256)failG2('SOURCE_CHANGED');
  try{return JSON.parse(line);}catch{failG2('SOURCE_FILE_INVALID');}
}
