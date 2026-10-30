import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {Modal,Switch} from '@heroui/react';
import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox} from "@heroui/react";
import {ToastFeedback} from '../../app/ToastFeedback';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useLocation,useNavigate} from 'react-router';
import {Bell,Volume2,X,ArrowUpRight} from 'lucide-react';
import {useUiStore} from '../../app/ui-store';
import {api,ApiError,readWorkbench} from '../../api/client';
import type {Principal} from '../../api/client';
import type {RealtimeView} from '../../realtime/useRealtime';
import {clearSessionAuthorization} from '../../app/authorization';
import {decodeReminderPage,decodeReminderPreferences,decodeReminderCoordination,mutedReminderPreferences,REMINDER_PREFERENCES_KEY} from '../../contracts/workbench-reminder-browser-contracts.mjs';
import type {WorkbenchReminderItem,WorkbenchReminderPreferences} from '../../../../../contracts/workbench_reminder_contracts';
import {desktopHost,getDesktopState,subscribeDesktopState,canRunWorkbenchTransport,isWorkbenchVisible} from '../../desktop/host';

const labels={AUTHORIZED_TEAM_NEW_REPORT:'团队收到新报修',RELATED_NEW_MATERIAL:'相关事项有新补充',RELATED_REOPEN:'相关工单已重开',RELATED_FOLLOW_UP_DUE:'相关工单跟进已到期',RELATED_REPORT_URGE:'报修人催促了相关工单'};
const readPreferences=()=>{try{return decodeReminderPreferences(localStorage.getItem(REMINDER_PREFERENCES_KEY));}catch{return mutedReminderPreferences;}};
interface Baseline {after:string;token:string}
interface Rechecked {requested:WorkbenchReminderItem['canonical_item'];canonical:WorkbenchReminderItem['canonical_item']|null}
const itemKey=(item:WorkbenchReminderItem['canonical_item'])=>item.kind+':'+item.id.toLowerCase();
interface Automatic {abort:AbortController|null;scope:string;leader:boolean;seen:Map<string,number>;saturated:boolean;lastSound:number;release:(()=>void)|null;channel:BroadcastChannel|null}
const blankAutomatic=():Automatic=>({abort:null,scope:'',leader:false,seen:new Map(),saturated:false,lastSound:0,release:null,channel:null});

/** The existing realtime adapter owns invalidation, its EventSource and its recovery timer. */
export function WorkbenchReminders({principal,realtime,navigationBlocked,desktopEpoch}:{principal:Principal;realtime:RealtimeView;navigationBlocked:boolean;desktopEpoch:string}){
  const open=useUiStore(s=>s.settingsOpen),closeSettings=useUiStore(s=>s.closeSettings);
  const nativeState=useSyncExternalStore(subscribeDesktopState,getDesktopState);
  const navigate=useNavigate(),location=useLocation(),blockedNavigation=useRef(navigationBlocked);blockedNavigation.current=navigationBlocked;
  const client=useQueryClient(),[preferences,setPreferences]=useState(readPreferences),[message,setMessage]=useState(''),[items,setItems]=useState<WorkbenchReminderItem[]>([]);
  const [armed,setArmed]=useState(false),[desktopArmed,setDesktopArmed]=useState(false),[environmentAvailable,setEnvironmentAvailable]=useState(()=>navigator.onLine&&canRunWorkbenchTransport());
  const nativeArmed=desktopHost?nativeState.remindersEnabled:desktopArmed&&preferences.desktop_enabled;
  const environmentRef=useRef(environmentAvailable);
  const queue=useRef(items);queue.current=items;const realtimeLive=useRef(false);realtimeLive.current=realtime.status==='live';
  const locateRequest=useRef<AbortController|null>(null),cluster=useRef<number|null>(null);
  const baseline=useRef<Baseline|null>(null),automatic=useRef(blankAutomatic()),audio=useRef<AudioContext|null>(null),notifications=useRef(new Set<Notification>()),generation=useRef(0);
  const authority=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.expires_epoch_ms]);
  const enabled=principal.workbench_reminders_enabled===true&&principal.realtime_sse_enabled;
  const liveNow=()=>enabled&&realtimeLive.current&&canRunWorkbenchTransport()&&navigator.onLine;
  const closeNotifications=()=>{for(const notification of notifications.current)notification.close();notifications.current.clear();void desktopHost?.clearReminders(desktopEpoch).catch(()=>{});};
  const stopAutomatic=()=>{if(cluster.current!==null)window.clearTimeout(cluster.current);cluster.current=null;automatic.current.abort?.abort();automatic.current.release?.();automatic.current.channel?.close();automatic.current=blankAutomatic();closeNotifications();};
  const closeAudio=()=>{const current=audio.current;audio.current=null;if(current)void current.close().catch(()=>{});};
  const invalidateEnvironment=()=>{generation.current++;baseline.current=null;locateRequest.current?.abort();locateRequest.current=null;stopAutomatic();closeAudio();void client.cancelQueries({queryKey:['reminders',principal.principal_id]},{revert:false});};
  const reset=()=>{baseline.current=null;setItems([]);setArmed(false);setDesktopArmed(false);stopAutomatic();};
  const save=(next:WorkbenchReminderPreferences)=>{setPreferences(next);try{localStorage.setItem(REMINDER_PREFERENCES_KEY,JSON.stringify(next));}catch{setMessage('偏好未保存；本次设置仍可使用。');}};
  const tone=async(automaticPlayback=false)=>{
    const epoch=generation.current;
    if(!audio.current)audio.current=new AudioContext();
    const context=audio.current;await context.resume();
    if(context.state!=='running'||audio.current!==context||automaticPlayback&&epoch!==generation.current||!isWorkbenchVisible()||automaticPlayback&&!liveNow())throw new Error('AUDIO_UNAVAILABLE');
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
  },[authority]);
  useEffect(()=>{
    const environment=()=>{const available=navigator.onLine&&canRunWorkbenchTransport();
      if(!available)invalidateEnvironment();else if(!environmentRef.current)baseline.current=null;
      environmentRef.current=available;
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
    if(!enabled||!environmentAvailable||realtime.status!=='live'||!armed&&!nativeArmed||!navigator.locks||typeof BroadcastChannel!=='function')return;
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
  },[authority,enabled,armed,nativeArmed,environmentAvailable,realtime.status]);
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
    if(armed&&preferences.sound_enabled&&isWorkbenchVisible())void tone(true).catch(()=>setMessage('声音暂不可用，视觉提醒继续。'));
    if(desktopHost&&nativeArmed){
      const first=unheard[0];if(first)void desktopHost.showReminder({epoch:desktopEpoch,id:first.reminder_id,kind:first.canonical_item.kind,itemId:first.canonical_item.id}).then(shown=>{if(!shown&&epoch===generation.current)setMessage('系统提醒暂不可用，站内提醒继续。');}).catch(()=>{if(epoch===generation.current)setMessage('系统提醒暂不可用，站内提醒继续。');});
    }else if(!desktopHost&&nativeArmed&&typeof Notification==='function'&&Notification.permission==='granted'){
      try{const first=unheard[0];if(!first)return;closeNotifications();const notice=new Notification('工作台有新的服务事项',{body:'请回到工作台核验当前事项。',tag:'wbint-'+first.reminder_id,silent:true});notifications.current.add(notice);notice.onclose=()=>notifications.current.delete(notice);}
      catch{setMessage('桌面通知暂不可用，视觉提醒继续。');}
      // Ordinary browser notifications retain their original no-navigation behavior.
    }
    },750);
  },[page.dataUpdatedAt]);
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
  useEffect(()=>desktopHost?.onReminderClick(reminder=>{
    if(reminder.epoch!==desktopEpoch)return;
    if(blockedNavigation.current){setMessage('请先完成当前输入或核对未确认操作，再定位新事项。');return;}
    const item=queue.current.find(row=>row.reminder_id===reminder.id&&row.canonical_item.kind===reminder.kind&&row.canonical_item.id===reminder.itemId);
    if(item)void locate(item);else setMessage('该提醒已过期，请在工作台查看当前事项。');
  }),[desktopEpoch,authority,location.search]);
  return <section className="workbench-reminders" aria-label="站内提醒" data-reminders-ready={Boolean(enabled&&baseline.current&&page.isSuccess)}>
    {items.length?<ul aria-label="当前提醒">{items.map(item=><li key={item.reminder_id} data-reminder-id={item.reminder_id}><span>{labels[item.reason]}</span><HButton type="button" aria-label="定位事项" isDisabled={navigationBlocked} onClick={()=>{void locate(item);}} variant="secondary">定位事项</HButton><HButton type="button" aria-label="移除此提醒" onClick={()=>setItems(previous=>previous.filter(row=>row.reminder_id!==item.reminder_id))} variant="secondary">移除</HButton></li>)}</ul>:null}
    {message?<ToastFeedback source="reminders" role="status">{message}</ToastFeedback>:null}{page.isError?<ToastFeedback source="reminders" role="status">提醒暂未更新，现有事项仍可操作。</ToastFeedback>:null}
    <Modal.Backdrop className="workbench-modal-backdrop" isOpen={open} onOpenChange={next=>{if(!next)closeSettings();}}><Modal.Container size="lg" className="workbench-modal-container"><Modal.Dialog data-workbench-overlay className="workbench-settings" aria-labelledby="settings-title"><header className="settings-heading"><div><h2 id="settings-title">设置</h2><p>调整这台设备的提醒方式</p></div><HButton type="button" className="icon-button" aria-label="关闭设置" onClick={closeSettings} variant="secondary"><X size={20}/></HButton></header><div className="settings-content"><section className="settings-section" aria-labelledby="reminder-settings-title"><h3 id="reminder-settings-title">提醒偏好</h3><p className="settings-description">新报修、相关事项补充、重开、催促和到期跟进，按当前权限提醒。</p><div className="settings-row"><Volume2 size={20}/><div className="settings-copy"><strong>声音提醒</strong><p>收到新提醒时播放短音。每次打开页面后需主动开启。</p><HButton type="button" className="settings-test-sound" onClick={()=>{setArmed(true);void tone().catch(()=>setMessage('声音暂不可用，视觉提醒继续。'));}} variant="secondary">试听短音</HButton></div>
      <Switch aria-label="开启声音提醒" isSelected={preferences.sound_enabled&&armed} onChange={event=>{const value=event;save({...preferences,sound_enabled:value});setArmed(value);if(value)void tone().catch(()=>setMessage('声音暂不可用，视觉提醒继续。'));}} className="settings-toggle"><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div>
      <div className="settings-row"><Bell size={20}/><div className="settings-copy"><strong>桌面通知</strong><p>在窗口外显示通用提醒，不展示报修内容。</p></div>
      <Switch aria-label="开启桌面通知" isSelected={nativeArmed} onChange={event=>{const value=event;
        if(desktopHost){void desktopHost.setReminders(value).then(accepted=>{save({...preferences,desktop_enabled:accepted});if(value&&!accepted)setMessage('当前会话无法开启提醒。');}).catch(()=>setMessage('桌面提醒暂不可用。'));return;}
        if(!value){setDesktopArmed(false);save({...preferences,desktop_enabled:false});closeNotifications();return;}
        if(typeof Notification!=='function'){setMessage('此浏览器不支持桌面通知，视觉提醒继续。');return;}
        const epoch=generation.current;void Notification.requestPermission().then(permission=>{if(epoch!==generation.current)return;const accepted=permission==='granted';setDesktopArmed(accepted);save({...preferences,desktop_enabled:accepted});if(!accepted)setMessage('桌面通知未开启，视觉提醒继续。');}).catch(()=>{if(epoch===generation.current)setMessage('桌面通知暂不可用，视觉提醒继续。');});}} className="settings-toggle"><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div></section>
      {principal.source_group_directory_enabled&&principal.roles.includes('ADMIN')?<section className="settings-section"><h3>工作台管理</h3><Link className="settings-link" to="/settings/source-groups" data-action="open-source-groups" aria-disabled={navigationBlocked} onClick={event=>{if(navigationBlocked)event.preventDefault();else closeSettings();}}>来源群名称<ArrowUpRight size={16}/></Link></section>:null}</div><footer className="settings-footer"><span>仅保存在当前设备，不影响其他同事。</span><HButton type="button" onClick={closeSettings} variant="secondary">完成</HButton></footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </section>;
}
