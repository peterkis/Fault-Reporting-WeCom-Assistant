export interface DesktopState {
  version:1; visible:boolean; focused:boolean; locked:boolean; suspended:boolean;
  remindersEnabled:boolean; revision:number;
}
export const TITLEBAR_HEIGHT=40;
export type ChromeAction='menu'|'minimize'|'maximize'|'close'|'reconnect';
export type RecoveryState='offline'|'unavailable'|'reconnecting'|'failed'|null;
export interface ChromeState {maximized:boolean;focused:boolean;menuOpen:boolean;appVersion:string;booting:boolean;recovery:RecoveryState;loginExpired:boolean}
export interface ChromeBridge {state():Promise<ChromeState>;command(action:ChromeAction):Promise<void>;onState(callback:(state:ChromeState)=>void):()=>void}
export function readChromeAction(value:unknown):ChromeAction {
  if(value==='menu'||value==='minimize'||value==='maximize'||value==='close'||value==='reconnect')return value;
  throw Error('DESKTOP_CHROME_ACTION_INVALID');
}
export interface DesktopContext {epoch:string|null;blocked:boolean;live:boolean;remindersAvailable:boolean}
export interface DesktopReminder {epoch:string;id:string;kind:'ticket'|'review'|'intake';itemId:string}
export interface LoginBridge {version:1;getAppVersion():Promise<string>;quit():Promise<void>}
export function motionPreference(args:readonly string[]):'reduce'|'no-preference'{return args.includes('--wecom-reduced-motion')?'reduce':'no-preference';}
export interface DesktopBridge {
  version:1;
  getState():Promise<DesktopState>;
  onState(callback:(state:DesktopState)=>void):()=>void;
  updateContext(context:DesktopContext):Promise<void>;
  setReminders(enabled:boolean):Promise<boolean>;
  showReminder(reminder:DesktopReminder):Promise<boolean>;
  clearReminders(epoch:string):Promise<void>;
  onReminderClick(callback:(reminder:DesktopReminder)=>void):()=>void;
  requestLogin():Promise<void>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('DESKTOP_INPUT_INVALID');
  const record=value as Record<string,unknown>;
  if(Object.keys(record).length!==keys.length||keys.some(key=>!Object.hasOwn(record,key)))throw Error('DESKTOP_INPUT_INVALID');
  return record;
}
export function serverOrigin(value:unknown):string {
  if(typeof value!=='string'||value.length>512)throw Error('DESKTOP_ORIGIN_INVALID');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.hostname.endsWith('.invalid'))throw Error('DESKTOP_ORIGIN_INVALID');
  return url.origin;
}
export function readConfig(value:unknown):{schemaVersion:1;serverOrigin:string}{
  const r=object(value,['schemaVersion','serverOrigin']);
  if(r.schemaVersion!==1)throw Error('DESKTOP_CONFIG_VERSION_INVALID');
  return {schemaVersion:1,serverOrigin:serverOrigin(r.serverOrigin)};
}
export function businessDocument(value:string,origin:string):boolean {
  try{const url=new URL(value);return url.origin===origin&&!url.username&&!url.password&&(url.pathname==='/workbench/app'||url.pathname.startsWith('/workbench/app/'));}catch{return false;}
}
export const OFFICIAL_LOGIN_PATH='/workbench/desktop';
export const EMBEDDED_LOGIN_PATH='/workbench/desktop/embedded';
export type LoginEntryPath=typeof OFFICIAL_LOGIN_PATH|typeof EMBEDDED_LOGIN_PATH;
export function loginEntryPath(value:string,origin:string):LoginEntryPath|null {
  try{const url=new URL(value);if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||url.search||url.hash)return null;return url.pathname===OFFICIAL_LOGIN_PATH?OFFICIAL_LOGIN_PATH:url.pathname===EMBEDDED_LOGIN_PATH?EMBEDDED_LOGIN_PATH:null;}catch{return null;}
}
export function embeddedLoginDocument(value:string,origin:string):boolean {
  return loginEntryPath(value,origin)===EMBEDDED_LOGIN_PATH;
}
/** Only reconstruct safe GET documents. Never retain OAuth queries or replay a callback. */
export function recoveryTarget(value:string,origin:string,method:string,entry:LoginEntryPath):string|null {
  if(method!=='GET'||!allowedNavigation(value,origin))return null;
  const url=new URL(value);
  if(businessDocument(value,origin)&&!url.pathname.startsWith('/workbench/app/assets/'))return origin+url.pathname;
  return origin+(loginEntryPath(value,origin)??entry);
}
export function connectionFailure(code:number):boolean {
  return [-2,-7,-21,-100,-101,-102,-103,-104,-105,-106,-109,-118,-130,-137,-138].includes(code);
}
/** Only the fixed attachment names/types produced by the authorized renderer. */
export function allowedAttachmentDownload(input:{url:string;filename:string;mime:string;bytes:number},origin:string):boolean {
  const types:Record<string,{extension:string;limit:number}>={
    'image/png':{extension:'png',limit:10},'image/jpeg':{extension:'jpg',limit:10},'image/webp':{extension:'webp',limit:10},
    'audio/amr':{extension:'amr',limit:5},'audio/wav':{extension:'wav',limit:5},'audio/x-wav':{extension:'wav',limit:5},'audio/mp4':{extension:'m4a',limit:5},'audio/mpeg':{extension:'mp3',limit:5},'audio/webm':{extension:'webm',limit:5},'audio/ogg':{extension:'ogg',limit:5},
    'video/mp4':{extension:'mp4',limit:20},'video/webm':{extension:'webm',limit:20},'video/quicktime':{extension:'mov',limit:20},
  };
  const format=Object.hasOwn(types,input.mime)?types[input.mime]:undefined,prefix='blob:'+origin+'/';
  return !!format&&input.url.startsWith(prefix)&&uuid.test(input.url.slice(prefix.length))&&Number.isSafeInteger(input.bytes)&&input.bytes>0&&input.bytes<=format.limit*1024*1024
    &&(input.filename==='report-material.'+format.extension||['image/png','image/jpeg'].includes(input.mime)&&input.filename==='report-attachment.'+format.extension);
}
export function allowedNavigation(value:string,origin:string):boolean {
  try{
    const url=new URL(value);if(url.username||url.password||url.protocol!=='https:')return false;
    if(url.origin===origin)return url.pathname==='/workbench'||url.pathname.startsWith('/workbench/');
    return url.origin==='https://login.work.weixin.qq.com'&&(url.pathname==='/wwlogin/sso/login'||url.pathname==='/wwlogin/sso/login/');
  }catch{return false;}
}
export function readContext(value:unknown):DesktopContext {
  const r=object(value,['epoch','blocked','live','remindersAvailable']);
  if(!(r.epoch===null||typeof r.epoch==='string'&&uuid.test(r.epoch))||typeof r.blocked!=='boolean'||typeof r.live!=='boolean'||typeof r.remindersAvailable!=='boolean'||r.epoch===null&&(r.live||r.remindersAvailable))throw Error('DESKTOP_CONTEXT_INVALID');
  return {epoch:r.epoch,blocked:r.blocked,live:r.live,remindersAvailable:r.remindersAvailable};
}
export function navigationFailure(value:string,origin:string,status:number):'server'|'access'|'service'|'page'|null {
  if(!Number.isInteger(status)||status<400||status>599||!allowedNavigation(value,origin))return null;
  const url=new URL(value);
  if(status===404&&url.origin===origin&&[OFFICIAL_LOGIN_PATH,EMBEDDED_LOGIN_PATH].includes(url.pathname))return 'server';
  if(status===401||status===403)return 'access';
  return status>=500?'service':'page';
}
/** A trusted desktop intent expires after five minutes; renew before its cookie does. */
export function loginRefreshDelay(value:string,origin:string,status:number,headers:Record<string,string[]>):number|null {
  try{
    const url=new URL(value);
    if(url.origin!==origin||url.username||url.password||url.search||url.hash||!((url.pathname===OFFICIAL_LOGIN_PATH&&status===302)||(url.pathname===EMBEDDED_LOGIN_PATH&&status===200)))return null;
    const values=Object.entries(headers).filter(([key])=>key.toLowerCase()==='set-cookie').flatMap(([,cookies])=>cookies).filter(cookie=>cookie.startsWith('__Host-wecom_workbench_intent='));
    if(values.length!==1)return null;
    const ages=values[0]!.split(';').map(part=>part.trim()).filter(part=>/^max-age=/iu.test(part));
    if(ages.length!==1)return null;
    const raw=ages[0]!.slice(8);if(!/^[1-9][0-9]{0,2}$/u.test(raw))return null;
    const age=Number(raw);return age<=300?Math.max(1,age-60)*1000:null;
  }catch{return null;}
}
export function readReminder(value:unknown):DesktopReminder {
  const r=object(value,['epoch','id','kind','itemId']);
  if(typeof r.epoch!=='string'||!uuid.test(r.epoch)||typeof r.id!=='string'||!/^[a-f0-9]{64}$/u.test(r.id)||typeof r.kind!=='string'||!['ticket','review','intake'].includes(r.kind)||typeof r.itemId!=='string'||!uuid.test(r.itemId))throw Error('DESKTOP_REMINDER_INVALID');
  return {epoch:r.epoch,id:r.id,kind:r.kind as DesktopReminder['kind'],itemId:r.itemId};
}
