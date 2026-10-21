// Explicit local development preview. Vite erases this module and its fixtures from production.
import type{Bootstrap,ReportItem,RequestDetail,H5RequestInput}from'../api/types';
import{applyTheme}from'../lib/preferences';
import i18n from'../i18n';
import photoLightOne from'../assets/reference-3.jpg';
import photoLightTwo from'../assets/reference-4.jpg';
import avatarLight from'../assets/reference-5.jpg';
import avatarDark from'../assets/reference-7.jpg';
import photoDarkOne from'../assets/reference-1.jpg';
import photoDarkTwo from'../assets/reference-2.jpg';
const ref='11111111111111111111111111111111';
const now=String(Date.UTC(2026,9,20,6,48)),created=String(Date.UTC(2026,9,20,6,32));
const local='2026-10-20 14:32:00';
const extension={ticket_version:5,media:[],handler:{name:'王浩',team_name:'信息科 · 硬件运维组',phone:'13900001120',avatar_url:null,chat_url:null},public_progress:{summary:'已完成进纸胶辊清洁，正在检查进纸传感器并测试打印。',estimated_at:'2026-10-20 15:03:00',estimated_epoch_ms:String(Date.UTC(2026,9,20,7,3)),version:1,updated_at:'2026-10-20 14:48:00',updated_epoch_ms:now},urge:{active:false,count:0,last_urged_at:null,last_urged_epoch_ms:null,next_allowed_at:null,next_allowed_epoch_ms:null,can_urge:true},evaluation:{can_evaluate:false,completed_round_ref:null,completed_round_no:null,ticket_version:5,rating:null,comment:null,evaluated_at:null,evaluated_epoch_ms:null},intent:'FAULT' as const};
const boot:Bootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'local-preview-csrf',recovery_scope:'local-preview-member-scope',h5:{profile:{name:'林主任医师',department:'心内科一病区',phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:true,sdk:{enabled:false,corp_id:null,agent_id:null},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}}};
const fakeDate=(value:string)=>value as ReportItem['created_at'];
function fixtureItems():ReportItem[]{return[
 {kind:'WEB_REQUEST',ref,display_status:'TICKET_CREATED',created_at:fakeDate(local),created_epoch_ms:created as ReportItem['created_epoch_ms'],ticket:{ticket_no:'REP-20231024-082',status:'IN_PROGRESS'},safe_summary:'护士站 3 号发药机标签打印机卡纸并提示代码 E-102',safe_location:'护士站',service_category:'硬件打印机',h5:extension},
 {kind:'WEB_REQUEST',ref:'22222222222222222222222222222222',display_status:'TICKET_CREATED',created_at:fakeDate(local),created_epoch_ms:String(Date.UTC(2026,9,20,1,30)) as ReportItem['created_epoch_ms'],ticket:{ticket_no:'IT-20231024-019',status:'CLOSED'},safe_summary:'门诊 2 诊室 HIS 系统处方无法签名认证',service_category:'软件HIS',h5:{handler:null,public_progress:{...extension.public_progress,summary:'已远程重启医保签名 CA 驱动服务，并重新校验医护数字证书完成。'}}},
 {kind:'WEB_REQUEST',ref:'33333333333333333333333333333333',display_status:'TICKET_CREATED',created_at:fakeDate(local),created_epoch_ms:String(Date.UTC(2026,9,19,8,45)) as ReportItem['created_epoch_ms'],ticket:{ticket_no:'IT-20231023-145',status:'OPEN'},safe_summary:'病区移动查房平板 WiFi 无法获取 IP 地址',service_category:'移动网络'}
];}
function detailFixture(requestRef:string,completed:boolean):RequestDetail {
 return{request_ref:requestRef,intake_no:'YXX-20261020-001',source_kind:'WEB_REQUEST',input_revision:'1',processed_revision:'1',display_status:'TICKET_CREATED',needs_action:null,safe_description:'护士站 3 号发药机标签打印机卡纸并提示代码 E-102',supplements:[],safe_location:'心内科一病区 · 护士站',created_at:fakeDate(local),created_epoch_ms:created as RequestDetail['created_epoch_ms'],updated_at:fakeDate(local),updated_epoch_ms:now as RequestDetail['updated_epoch_ms'],ticket:{ticket_no:'REP-20231024-082',status:completed?'CLOSED':'IN_PROGRESS'},safe_clarification:null,can_supplement:!completed,h5:{...structuredClone(extension),media:[{media_ref:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'VOICE',mime_type:'audio/wav',byte_size:16044,duration_ms:12000,url:'',playback_status:'READY',playback_mime_type:'audio/wav'},{media_ref:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',kind:'IMAGE',mime_type:'image/jpeg',byte_size:28000,duration_ms:null,url:'',playback_status:'READY',playback_mime_type:'image/jpeg'},{media_ref:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind:'IMAGE',mime_type:'image/jpeg',byte_size:28000,duration_ms:null,url:'',playback_status:'READY',playback_mime_type:'image/jpeg'}],evaluation:{...extension.evaluation,can_evaluate:completed,completed_round_ref:completed?'dddddddddddddddddddddddddddddddd':null,completed_round_no:completed?1:null},urge:{...extension.urge,can_urge:!completed}},...(completed?{feedback_context:{schema_version:1,can_feedback:true,completed_round_ref:'dddddddddddddddddddddddddddddddd',completed_round_no:1,ticket_version:5,rejection:null}}:{})};
}
function silentWav(){const bytes=new Uint8Array(16044),v=new DataView(bytes.buffer);const word=(offset:number,text:string)=>Array.from(text).forEach((letter,index)=>{bytes[offset+index]=letter.charCodeAt(0);});word(0,'RIFF');v.setUint32(4,16036,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,16000,true);return bytes;}
export async function installPreview(){
 if(!import.meta.env.DEV)return;
 const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';applyTheme(theme);await i18n.changeLanguage(params.get('lang')==='en'?'en':'zh-CN');document.documentElement.lang=i18n.language;
 const nativeFetch=globalThis.fetch.bind(globalThis),commands=new Map<string,unknown>(),details=new Map<string,RequestDetail>();let items=params.get('state')==='empty'?[]:fixtureItems();let dropped=false;let denied=false;
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const getDetail=(id:string)=>{let value=details.get(id);if(!value){value=detailFixture(id,params.get('state')==='completed'||id.startsWith('2'));if(value.h5.handler)value.h5.handler.avatar_url=theme==='dark'?avatarDark:avatarLight;details.set(id,value);}return value;};
 const receipt=(id:string,requestRef:string)=>({client_command_id:id,status:'ACCEPTED',request_ref:requestRef,intake_no:'YXX-20261020-001',accepted_revision:'1',accepted_at:local,accepted_epoch_ms:now});
 const reservations=new Map<string,unknown>();
 const reportPage=(url:URL)=>{const q=url.searchParams.get('search')?.toLowerCase(),status=url.searchParams.get('status'),source=url.searchParams.get('source');return{items:items.filter(item=>(!q||(item.safe_summary??'').toLowerCase().includes(q)||item.ticket?.ticket_no.toLowerCase().includes(q))&&(!source||(source==='WEB'&&item.kind==='WEB_REQUEST'||source==='BOT'&&item.kind==='BOT_TICKET'))&&(!status||(status==='COMPLETED'?item.ticket?.status==='CLOSED':status==='OPEN'?item.ticket?.status==='OPEN':item.ticket?.status==='IN_PROGRESS'))),next_cursor:null};};
 const departmentPage=()=>({items:items.map(item=>({ticket_no:item.ticket?.ticket_no,service_category:item.service_category??null,status:item.ticket?.status,public_progress:item.h5?.public_progress??null,created_at:local})),total:4,active_count:1,next_cursor:null});
 const timelinePage=(detail:RequestDetail)=>({items:[{event_type:'TICKET_UPDATED',occurred_at:local,occurred_epoch_ms:now,summary:'工程师到场检修中',ticket:detail.ticket},{event_type:'TICKET_UPDATED',occurred_at:local,occurred_epoch_ms:String(Number(now)-8*60_000),summary:'工程师已接单',ticket:detail.ticket},{event_type:'REQUEST_ACCEPTED',occurred_at:local,occurred_epoch_ms:created,summary:'报修已受理',ticket:detail.ticket}],next_cursor:null});
 class PreviewXHR{
  status=0;responseText='';withCredentials=false;upload:{onprogress:((event:ProgressEvent)=>void)|null}={onprogress:null};onload:(()=>void)|null=null;onerror:(()=>void)|null=null;onabort:(()=>void)|null=null;private timer:number|null=null;private url='';
  open(_method:string,url:string){this.url=url;}setRequestHeader(_name:string,_value:string){}
  send(body:Blob){this.timer=window.setTimeout(()=>{this.upload.onprogress?.(new ProgressEvent('progress',{lengthComputable:true,loaded:body.size,total:body.size}));this.status=200;this.responseText=JSON.stringify({media_ref:this.url.split('/').at(-2),kind:body.type.startsWith('image/')?'IMAGE':body.type.startsWith('video/')?'VIDEO':'VOICE',playback_status:'READY'});this.onload?.();},150);}
  abort(){if(this.timer)clearTimeout(this.timer);this.onabort?.();}
 }
 Object.defineProperty(window,'XMLHttpRequest',{configurable:true,value:PreviewXHR});
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(!url.pathname.startsWith('/api/yixiaoxiu'))return nativeFetch(input,init);
  const path=url.pathname.replace('/api/yixiaoxiu',''),method=init?.method??'GET';
  const body:unknown=init?.body&&typeof init.body==='string'?JSON.parse(init.body):null;
  const obj=body&&typeof body==='object'?body:{};
  const id='client_command_id'in obj&&typeof obj.client_command_id==='string'?obj.client_command_id:'';
  if(params.get('auth')==='403'||denied)return json({code:'YXX_MEMBER_FORBIDDEN'},403);
  if(params.get('error')==='503')return json({code:'YXX_ENTRY_UNAVAILABLE'},503);
  if(path==='/bootstrap')return json(boot);
  if(path==='/h5/department-summary')return json({total:4,active_count:1,membership_revision:'preview-membership-1'});
  if(path==='/h5/entry'){
   const view=url.searchParams.get('view');let data:unknown=null;
   if(view==='home')data={recent_reports:items.slice(0,3),department_summary:boot.h5.can_view_department?{total:4,active_count:1,membership_revision:'preview-membership-1'}:null};
   else if(view==='reports')data={reports:reportPage(url)};
   else if(view==='department')data={department:departmentPage()};
   else if(view==='request'){const requestRef=url.searchParams.get('request_ref')??ref,detail=getDetail(requestRef);data={detail:{...detail,supplements:detail.supplements.slice(-20),supplements_cursor:null,h5:{...detail.h5,media:detail.h5.media.map(item=>({...item,thumbnail:item.kind==='IMAGE'?{status:'READY',url:'/api/yixiaoxiu/requests/'+encodeURIComponent(requestRef)+'/media/'+encodeURIComponent(item.media_ref)+'?variant=THUMBNAIL',mime_type:item.mime_type,byte_size:item.byte_size}:null}))}},timeline:{status:'READY',data:timelinePage(detail)}};}
   else if(view!=='report')return json({code:'YXX_INPUT_INVALID'},400);
   return json({schema_version:1,view,bootstrap:boot,membership_revision:'preview-membership-1',data});
  }
  if(path==='/my-reports')return json(reportPage(url));
  if(path==='/department-reports')return json(departmentPage());
  if(path==='/media/uploads'&&method==='POST'){const mediaRef=crypto.randomUUID();const result={media_ref:mediaRef,kind:'kind'in obj?obj.kind:'IMAGE'};reservations.set(mediaRef,result);return json(result,201);}
  if(path.startsWith('/media/uploads/'))return method==='DELETE'?new Response(null,{status:204}):json(reservations.get(path.split('/')[3]??'')??{});
  if(path.startsWith('/commands/')){const commandId=path.split('/').at(-1)??'';return json(commands.has(commandId)?{state:'COMMITTED',client_command_id:commandId,result:commands.get(commandId)}:{state:'UNKNOWN',client_command_id:commandId});}
  if(path==='/requests'&&method==='POST'){
   if(params.get('submit')==='409')return json({code:'COMMAND_CONFLICT'},409);
   if(params.get('submit')==='403'){denied=true;return json({code:'FORBIDDEN'},403);}
   const payload=obj as H5RequestInput,requestRef=crypto.randomUUID().replaceAll('-',''),result=receipt(id,requestRef);commands.set(id,result);
   const detail=getDetail(requestRef);detail.safe_description=payload.description??'';detail.safe_location=payload.location.text;detail.h5.intent=payload.intent;detail.h5.media=[];detail.h5.handler=null;detail.h5.public_progress=null;detail.ticket={ticket_no:'IT-20261020-001',status:'OPEN'};items=[{kind:'WEB_REQUEST',ref:requestRef,display_status:'TICKET_CREATED',created_at:fakeDate(local),created_epoch_ms:now as ReportItem['created_epoch_ms'],ticket:detail.ticket,safe_summary:payload.description||i18n.t(payload.intent==='CONTACT_REQUEST'?'contactIntent':'noDescription')},...items];
   if(params.get('submit')==='unknown'&&!dropped){dropped=true;throw new TypeError('Synthetic response lost after commit');}return json(result,202);
  }
  const match=/^\/requests\/([^/]+)(\/.*)?$/.exec(path);if(match){
   const requestRef=match[1]??'',suffix=match[2]??'',detail=getDetail(requestRef);
   if(suffix==='/timeline')return json(timelinePage(detail));
   if(suffix==='/supplements'&&method==='GET')return json({items:detail.supplements,next_cursor:null});
   if(suffix.startsWith('/media/')){const mediaRef=suffix.split('/')[2];if(mediaRef?.startsWith('aaaa'))return new Response(silentWav(),{headers:{'content-type':'audio/wav'}});return nativeFetch(mediaRef?.startsWith('bbbb')?(theme==='dark'?photoDarkOne:photoLightOne):(theme==='dark'?photoDarkTwo:photoLightTwo));}
   if(suffix.includes('/member-commands/')||suffix.includes('/feedback/commands/')){const commandId=suffix.split('/').at(-1)??'',value=commands.get(commandId);const result=value&&typeof value==='object'?{...value,replayed:true}:value;const base={client_command_id:commandId,request_ref:requestRef,...(suffix.includes('/member-commands/')?{purpose:url.searchParams.get('purpose')}:{} )};return json(commands.has(commandId)?{...base,state:'COMMITTED',result}:{...base,state:'UNKNOWN'});}
   if(method==='POST'){
    const result={ok:true,replayed:false,client_command_id:id,request_ref:requestRef,purpose:suffix==='/urge'?'URGE':'EVALUATION',accepted_at:local,accepted_epoch_ms:now};commands.set(id,result);
    if(suffix==='/urge'){detail.h5.urge={...detail.h5.urge,active:true,can_urge:false,count:1};}
    if(suffix==='/evaluation'){detail.h5.evaluation={...detail.h5.evaluation,can_evaluate:false,rating:'rating'in obj&&typeof obj.rating==='number'?obj.rating:5,comment:'comment'in obj&&typeof obj.comment==='string'?obj.comment:null};}
    if(suffix==='/feedback'){const completedRoundRef=detail.feedback_context?.completed_round_ref??'dddddddddddddddddddddddddddddddd';detail.ticket={ticket_no:detail.ticket?.ticket_no??'',status:'REOPENED'};detail.feedback_context={schema_version:1,can_feedback:false,completed_round_ref:null,completed_round_no:null,ticket_version:null,rejection:'ROUND_ALREADY_REOPENED'};const feedbackResult={ok:true,replayed:false,request_ref:requestRef,completed_round_ref:completedRoundRef,reopened_round_no:2,ticket:{...detail.ticket,version:6}};commands.set(id,feedbackResult);return json(feedbackResult);}
    if(suffix==='/supplements'&&'text'in obj&&typeof obj.text==='string'){detail.supplements.push({input_revision:String(detail.supplements.length+2),text:obj.text});return json(receipt(id,requestRef));}
    return json(result);
   }
   return json(detail);
  }
  return json({code:'NOT_FOUND'},404);
 };
}
