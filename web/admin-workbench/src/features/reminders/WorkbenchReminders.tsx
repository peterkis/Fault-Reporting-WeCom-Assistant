import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useLocation,useNavigate} from 'react-router';
import {api,ApiError,readWorkbench} from '../../api/client';
import type {Principal} from '../../api/client';
import type {RealtimeView} from '../../realtime/useRealtime';
import {clearSessionAuthorization} from '../../app/authorization';
import {decodeReminderPage,decodeReminderPreferences,decodeReminderCoordination,mutedReminderPreferences,REMINDER_PREFERENCES_KEY} from '../../../../../src/workbench-reminder-browser-contracts.mjs';
import type {WorkbenchReminderItem,WorkbenchReminderPreferences} from '../../../../../contracts/workbench_reminder_contracts';

const labels={AUTHORIZED_TEAM_NEW_REPORT:'团队收到新报修',RELATED_NEW_MATERIAL:'相关事项有新补充',RELATED_REOPEN:'相关工单已重开',RELATED_FOLLOW_UP_DUE:'相关工单跟进已到期',RELATED_REPORT_URGE:'报修人催促了相关工单'};
const readPreferences=()=>{try{return decodeReminderPreferences(localStorage.getItem(REMINDER_PREFERENCES_KEY));}catch{return mutedReminderPreferences;}};
interface Baseline {after:string;token:string}
interface Rechecked {requested:WorkbenchReminderItem['canonical_item'];canonical:WorkbenchReminderItem['canonical_item']|null}
const itemKey=(item:WorkbenchReminderItem['canonical_item'])=>item.kind+':'+item.id.toLowerCase();
interface Automatic {abort:AbortController|null;scope:string;leader:boolean;seen:Map<string,number>;saturated:boolean;lastSound:number;release:(()=>void)|null;channel:BroadcastChannel|null}
const blankAutomatic=():Automatic=>({abort:null,scope:'',leader:false,seen:new Map(),saturated:false,lastSound:0,release:null,channel:null});

/** The existing realtime adapter owns invalidation, its EventSource and its recovery timer. */
export function WorkbenchReminders({principal,realtime,navigationBlocked}:{principal:Principal;realtime:RealtimeView;navigationBlocked:boolean}){
  const navigate=useNavigate(),location=useLocation(),blockedNavigation=useRef(navigationBlocked);blockedNavigation.current=navigationBlocked;
  const client=useQueryClient(),[preferences,setPreferences]=useState(readPreferences),[open,setOpen]=useState(false),[message,setMessage]=useState(''),[items,setItems]=useState<WorkbenchReminderItem[]>([]);
  const [armed,setArmed]=useState(false),[desktopArmed,setDesktopArmed]=useState(false),[environmentAvailable,setEnvironmentAvailable]=useState(()=>navigator.onLine&&document.visibilityState==='visible');
  const queue=useRef(items);queue.current=items;const realtimeLive=useRef(false);realtimeLive.current=realtime.status==='live';
  const locateRequest=useRef<AbortController|null>(null),cluster=useRef<number|null>(null);
  const baseline=useRef<Baseline|null>(null),automatic=useRef(blankAutomatic()),audio=useRef<AudioContext|null>(null),notifications=useRef(new Set<Notification>()),generation=useRef(0),settings=useRef<HTMLDialogElement>(null),settingsButton=useRef<HTMLButtonElement>(null);
  const authority=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.expires_epoch_ms]);
  const enabled=principal.workbench_reminders_enabled===true&&principal.realtime_sse_enabled;
  const liveNow=()=>enabled&&realtimeLive.current&&document.visibilityState==='visible'&&navigator.onLine;
  const closeNotifications=()=>{for(const notification of notifications.current)notification.close();notifications.current.clear();};
  const stopAutomatic=()=>{if(cluster.current!==null)window.clearTimeout(cluster.current);cluster.current=null;automatic.current.abort?.abort();automatic.current.release?.();automatic.current.channel?.close();automatic.current=blankAutomatic();closeNotifications();};
  const closeAudio=()=>{const current=audio.current;audio.current=null;if(current)void current.close().catch(()=>{});};
  const invalidateEnvironment=()=>{generation.current++;baseline.current=null;locateRequest.current?.abort();locateRequest.current=null;stopAutomatic();closeAudio();void client.cancelQueries({queryKey:['reminders',principal.principal_id]},{revert:false});};
  const reset=()=>{baseline.current=null;setItems([]);setArmed(false);setDesktopArmed(false);stopAutomatic();};
  const save=(next:WorkbenchReminderPreferences)=>{setPreferences(next);try{localStorage.setItem(REMINDER_PREFERENCES_KEY,JSON.stringify(next));}catch{setMessage('偏好未保存；本次设置仍可使用。');}};
  const tone=async(automaticPlayback=false)=>{
    const epoch=generation.current;
    if(!audio.current)audio.current=new AudioContext();
    const context=audio.current;await context.resume();
    if(context.state!=='running'||audio.current!==context||automaticPlayback&&epoch!==generation.current||document.visibilityState!=='visible'||automaticPlayback&&!liveNow())throw new Error('AUDIO_UNAVAILABLE');
    const source=context.createOscillator(),gain=context.createGain();source.frequency.value=660;gain.gain.setValueAtTime(0.04,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.12);
    source.connect(gain);gain.connect(context.destination);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();source.stop(context.currentTime+0.12);
  };
  const page=useQuery({queryKey:['reminders',principal.principal_id,authority],enabled:enabled&&environmentAvailable&&realtime.status==='live',retry:false,gcTime:0,queryFn:async({signal})=>{
    const epoch=generation.current,live=liveNow(),base=live?baseline.current:null;
    const params=new URLSearchParams({limit:'50',...(base?{after_event_id:base.after,baseline_token:base.token}:{})});
    let current=await readWorkbench('/api/workbench/reminders?'+params,signal,decodeReminderPage),received=[...current.items];
    for(let pages=1;current.next_cursor&&pages<4;pages++){
      params.set('cursor',current.next_cursor);current=await readWorkbench('/api/workbench/reminders?'+params,signal,decodeReminderPage);received.push(...current.items);
    }
    signal.throwIfAborted();if(epoch!==generation.current)throw new DOMException('REMINDER_SCOPE_CHANGED','AbortError');
    if(current.next_cursor){baseline.current=null;setMessage('本次更新较多，已重新建立提醒起点。');return {fresh:[],rechecked:[] as Rechecked[]};}
    baseline.current={after:current.as_of_event_id,token:current.baseline_token};
    const rechecked:Rechecked[]=[];
    // Reuse the original READ seam once per current queued object, at most 40, within this existing refresh.
    const targets=[...new Map(queue.current.slice(-40).map(item=>[itemKey(item.canonical_item),item.canonical_item])).values()];
    for(const requested of targets){
      try{const detail=await api.detail(requested.kind,requested.id,null,signal);rechecked.push({requested,canonical:{kind:detail.item.kind,id:detail.item.id}});}
      catch(error){signal.throwIfAborted();if(error instanceof ApiError&&error.status===401)throw error;
        if(error instanceof ApiError&&(error.status===403||error.status===404))rechecked.push({requested,canonical:null});
        // Temporary failure is not evidence of authority loss. Keep that original visual intent, without replaying it.
      }
    }
    signal.throwIfAborted();if(epoch!==generation.current)throw new DOMException('REMINDER_SCOPE_CHANGED','AbortError');
    return {fresh:base&&!current.reset_required&&live?received:[],rechecked};
  }});
  useEffect(()=>{
    reset();setMessage('');
    return()=>{generation.current++;locateRequest.current?.abort();locateRequest.current=null;baseline.current=null;stopAutomatic();closeAudio();
      try{localStorage.removeItem(REMINDER_PREFERENCES_KEY);}catch{/* Only this feature's own bounded preference is removed. */}
      void client.cancelQueries({queryKey:['reminders',principal.principal_id]},{revert:false});client.removeQueries({queryKey:['reminders',principal.principal_id]});};
  },[authority,enabled]);
  useEffect(()=>{
    const environment=()=>{const available=navigator.onLine&&document.visibilityState==='visible';
      if(!available)invalidateEnvironment();else baseline.current=null;
      setEnvironmentAvailable(available);setItems(previous=>previous.filter(item=>Date.now()-Date.parse(item.occurred_at.replace(' ','T')+'+08:00')<600_000));};
    window.addEventListener('online',environment);window.addEventListener('offline',environment);document.addEventListener('visibilitychange',environment);
    return()=>{window.removeEventListener('online',environment);window.removeEventListener('offline',environment);document.removeEventListener('visibilitychange',environment);};
  },[authority,enabled]);
  useEffect(()=>{if(realtime.status!=='live')invalidateEnvironment();},[realtime.status]);
  useEffect(()=>{
    // The original successful business refresh clock also expires visuals while the auxiliary read is slow or unavailable.
    const now=Date.now();setItems(previous=>{const kept=previous.filter(item=>now-Date.parse(item.occurred_at.replace(' ','T')+'+08:00')<600_000);return kept.length===previous.length?previous:kept;});
  },[realtime.lastReadAt]);
  useEffect(()=>{
    if(page.error){generation.current++;baseline.current=null;if(cluster.current!==null)window.clearTimeout(cluster.current);cluster.current=null;closeNotifications();}
    if(page.error instanceof ApiError&&[401,403,404].includes(page.error.status)){
      reset();try{localStorage.removeItem(REMINDER_PREFERENCES_KEY);}catch{/* Other storage is not touched. */}
      if(page.error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
    }
  },[page.error]);
  useEffect(()=>client.getQueryCache().subscribe(event=>{
    const key=event.query.queryKey,error=event.query.state.error;
    if(event.type!=='updated'||key[0]!=='reminder-locate'||key[1]!==principal.principal_id||!(error instanceof ApiError)||![403,404].includes(error.status))return;
    setItems(previous=>previous.filter(item=>item.canonical_item.kind!==key[2]||item.canonical_item.id!==key[3]));closeNotifications();
  }),[client,principal.principal_id]);
  useEffect(()=>{
    if(!enabled||!environmentAvailable||realtime.status!=='live'||!armed&&!desktopArmed||!navigator.locks||typeof BroadcastChannel!=='function')return;
    let alive=true;const abort=new AbortController(),state=blankAutomatic();state.abort=abort;automatic.current=state;
    void crypto.subtle.digest('SHA-256',new TextEncoder().encode(authority)).then(buffer=>{
      if(!alive||abort.signal.aborted||automatic.current!==state||!liveNow())return;
      const scope=Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');state.scope=scope;
      const channel=new BroadcastChannel('wbint-reminders-v1');state.channel=channel;
      channel.onmessage=event=>{const decoded=decodeReminderCoordination(event.data,scope);if(!decoded||automatic.current!==state)return;
        if(decoded.kind==='RESET'){baseline.current=null;state.seen.clear();state.saturated=false;}
        else if(!state.seen.has(decoded.reminder_id)){if(state.seen.size>=256)state.saturated=true;else state.seen.set(decoded.reminder_id,Date.now());}};
      void navigator.locks.request('wbint-reminders-'+scope,{mode:'exclusive',signal:abort.signal},async lock=>{
        if(!lock||!alive||!liveNow())return;state.leader=true;generation.current++;baseline.current=null;
        await new Promise<void>(resolve=>{state.release=resolve;});state.leader=false;
      }).catch(()=>{state.leader=false;});
    }).catch(()=>setMessage('跨标签协调暂不可用，视觉提醒继续。'));
    return()=>{alive=false;abort.abort();stopAutomatic();closeAudio();};
  },[authority,enabled,armed,desktopArmed,environmentAvailable,realtime.status]);
  useEffect(()=>{
    const current=page.data;if(!current)return;
    const now=Date.now(),checked=new Map(current.rechecked.map(value=>[itemKey(value.requested),value.canonical]));
    const fresh=current.fresh.filter(item=>!(checked.has(itemKey(item.canonical_item))&&checked.get(itemKey(item.canonical_item))===null));
    setItems(previous=>{
      const merged=new Map<string,WorkbenchReminderItem>();
      for(const item of previous){const key=itemKey(item.canonical_item),canonical=checked.get(key);
        if(checked.has(key)&&canonical===null||now-Date.parse(item.occurred_at.replace(' ','T')+'+08:00')>=600_000)continue;
        merged.set(item.reminder_id,canonical?{...item,canonical_item:canonical}:item);
      }
      for(const item of fresh)if(now-Date.parse(item.occurred_at.replace(' ','T')+'+08:00')<600_000)merged.set(item.reminder_id,item);
      return [...merged.values()].slice(-40);
    });
    const state=automatic.current;if(!fresh.length||!liveNow()||!state.leader||state.saturated)return;
    // Expiring the deduplication window requires a new baseline, never eviction followed by replay.
    if([...state.seen.values()].some(seen=>now-seen>=600_000)){state.seen.clear();baseline.current=null;return;}
    const unheard=fresh.filter(item=>!state.seen.has(item.reminder_id));if(!unheard.length)return;
    if(state.seen.size+unheard.length>256){state.saturated=true;baseline.current=null;return;}
    for(const item of unheard){state.seen.set(item.reminder_id,now);state.channel?.postMessage({schema_version:1,authority_scope:state.scope,kind:'SEEN',reminder_id:item.reminder_id});}
    if(now-state.lastSound<2000||cluster.current!==null)return;
    const epoch=generation.current;cluster.current=window.setTimeout(()=>{cluster.current=null;
    if(epoch!==generation.current||automatic.current!==state||!state.leader||!liveNow())return;
    state.lastSound=Date.now();
    if(armed&&preferences.sound_enabled)void tone(true).catch(()=>setMessage('声音暂不可用，视觉提醒继续。'));
    if(desktopArmed&&preferences.desktop_enabled&&typeof Notification==='function'&&Notification.permission==='granted'){
      try{const first=unheard[0];if(!first)return;closeNotifications();const notice=new Notification('工作台有新的服务事项',{body:'请回到工作台核验当前事项。',tag:'wbint-'+first.reminder_id,silent:true});notifications.current.add(notice);notice.onclose=()=>notifications.current.delete(notice);}
      catch{setMessage('桌面通知暂不可用，视觉提醒继续。');}
      // No automatic navigation or object opening is attached to an operating-system event.
    }
    },750);
  },[page.dataUpdatedAt]);
  useEffect(()=>{if(open){settings.current?.showModal();}else{settings.current?.close();}},[open]);
  const locate=async(item:WorkbenchReminderItem)=>{
    if(navigationBlocked)return;locateRequest.current?.abort();const epoch=generation.current,abort=new AbortController();locateRequest.current=abort;
    try{const detail=await api.detail(item.canonical_item.kind,item.canonical_item.id,null,abort.signal);if(epoch!==generation.current||abort.signal.aborted||blockedNavigation.current)return;
      const target=document.querySelector<HTMLElement>('article.ticket-card[data-kind="'+detail.item.kind+'"][data-item-id="'+detail.item.id+'"]');
      if(target){target.dataset.reminderLocated='true';target.scrollIntoView({block:'nearest',behavior:'auto'});setMessage('已定位当前事项。');}
      else {const parameters=new URLSearchParams(location.search);parameters.delete('detail');parameters.set('locate','1');
        void navigate('/items/'+detail.item.kind+'/'+detail.item.id+'?'+parameters);setMessage('正在定位当前事项。');}
    }catch(error){if(epoch!==generation.current||abort.signal.aborted)return;if(error instanceof ApiError&&[403,404].includes(error.status)){setItems(previous=>previous.filter(row=>row.reminder_id!==item.reminder_id));closeNotifications();setMessage('该事项当前不可读取，提醒已移除。');}
      else if(error instanceof ApiError&&error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else setMessage('本次定位未完成，请重试。');}
    finally{if(locateRequest.current===abort)locateRequest.current=null;}
  };
  if(!enabled)return null;
  const closeSettings=()=>{setOpen(false);settingsButton.current?.focus();};
  return <section className="workbench-reminders" aria-label="站内提醒" data-reminders-ready={Boolean(baseline.current&&page.isSuccess)}><button ref={settingsButton} type="button" aria-label="提醒偏好" onClick={()=>setOpen(true)}>提醒偏好</button>
    {items.length?<ul aria-label="当前提醒">{items.map(item=><li key={item.reminder_id} data-reminder-id={item.reminder_id}><span>{labels[item.reason]}</span><button type="button" aria-label="定位事项" disabled={navigationBlocked} onClick={()=>{void locate(item);}}>定位事项</button><button type="button" aria-label="移除此提醒" onClick={()=>setItems(previous=>previous.filter(row=>row.reminder_id!==item.reminder_id))}>移除</button></li>)}</ul>:null}
    {message?<p role="status">{message}</p>:null}{page.isError?<p role="status">提醒暂未更新，现有事项仍可操作。</p>:null}
    <dialog ref={settings} role="dialog" aria-label="本浏览器提醒偏好" onCancel={event=>{event.preventDefault();closeSettings();}}><h2>本浏览器提醒偏好</h2><p>声音初始静音。新页面须主动开启，设置仅保存在本浏览器。</p>
      <label><input type="checkbox" aria-label="开启声音提醒" checked={preferences.sound_enabled&&armed} onChange={event=>{const value=event.target.checked;save({...preferences,sound_enabled:value});setArmed(value);if(value)void tone().catch(()=>setMessage('声音暂不可用，视觉提醒继续。'));}}/>开启声音提醒</label>
      <button type="button" onClick={()=>{setArmed(true);void tone().catch(()=>setMessage('声音暂不可用，视觉提醒继续。'));}}>试听短音</button>
      <label><input type="checkbox" aria-label="开启桌面通知" checked={preferences.desktop_enabled&&desktopArmed} onChange={event=>{const value=event.target.checked;if(!value){setDesktopArmed(false);save({...preferences,desktop_enabled:false});closeNotifications();return;}
        if(typeof Notification!=='function'){setMessage('此浏览器不支持桌面通知，视觉提醒继续。');return;}
        const epoch=generation.current;void Notification.requestPermission().then(permission=>{if(epoch!==generation.current)return;const accepted=permission==='granted';setDesktopArmed(accepted);save({...preferences,desktop_enabled:accepted});if(!accepted)setMessage('桌面通知未开启，视觉提醒继续。');}).catch(()=>{if(epoch===generation.current)setMessage('桌面通知暂不可用，视觉提醒继续。');});}}/>开启桌面通知</label>
      <button type="button" aria-label="关闭提醒偏好" onClick={closeSettings}>关闭</button></dialog>
  </section>;
}
