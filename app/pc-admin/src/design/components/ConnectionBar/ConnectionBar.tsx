import {useEffect,useRef,useState} from 'react';
import {Check,RefreshCw,WifiOff} from 'lucide-react';
import type {RealtimeView} from '../../../realtime/useRealtime';
import {connectionTiming} from '../../hooks/state-timing';
import {Button} from '../Button/Button';
import './connection-bar.css';

/** Presentation subscribes to the existing transport; only deadline timers, never polling. */
export function ConnectionBar({realtime}:{realtime:RealtimeView}){
  const [online,setOnline]=useState(navigator.onLine),[stale,setStale]=useState(false),[recovered,setRecovered]=useState(false);
  const since=useRef<number|null>(null),hadBreak=useRef(false);
  const down=!online||realtime.status==='offline'||realtime.disconnectedAt!==null&&realtime.disconnectedAt!==undefined;
  const timing=connectionTiming();
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{
    if(!down)return;
    hadBreak.current=true;since.current??=realtime.disconnectedAt??Date.now();setRecovered(false);
    if((realtime.retryCount??0)<3)return;
    const timeout=window.setTimeout(()=>setStale(true),Math.max(0,since.current+timing.stale-Date.now()));
    return()=>window.clearTimeout(timeout);
  },[down,realtime.disconnectedAt,realtime.retryCount,timing.stale]);
  useEffect(()=>{
    if(down||!hadBreak.current||realtime.lastReadAt===null||realtime.lastReadAt<(since.current??0))return;
    hadBreak.current=false;since.current=null;setStale(false);setRecovered(true);

  },[down,realtime.lastReadAt,timing.recovered]);
  useEffect(()=>{if(!recovered)return;const timeout=window.setTimeout(()=>setRecovered(false),timing.recovered);return()=>window.clearTimeout(timeout);},[recovered,timing.recovered]);
  const mode=down?(stale?'stale':'offline'):recovered?'recovered':null;
  const minutes=Math.max(1,Math.floor((Date.now()-(realtime.lastReadAt??since.current??Date.now()))/60_000));
  return <div className="ds-connection-slot" data-open={mode?'true':undefined} aria-hidden={!mode}><div className="ds-connection-bar" data-connection={mode??'hidden'} role={mode?'status':undefined}>{mode==='recovered'?<Check aria-hidden="true"/>:<WifiOff aria-hidden="true"/>}<span>{mode==='recovered'?'已重新连接，内容已更新':mode==='stale'?'显示的是 '+minutes+' 分钟前的内容':'连接已断开，正在重新连接…'}</span>{mode==='stale'?<Button tone="ghost" size="sm" onPress={()=>{setStale(false);realtime.reconnect?.();}}><RefreshCw aria-hidden="true"/>刷新</Button>:null}</div></div>;
}
