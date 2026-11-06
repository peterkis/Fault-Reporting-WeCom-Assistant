import type {StartupBridge,StartupFailure,StartupSignal,StartupState} from './policy.mjs';

declare global {interface Window {desktopStartup:StartupBridge}}
const video=document.getElementById('startup-video');
if(!(video instanceof HTMLVideoElement))throw Error('STARTUP_VIDEO_DOCUMENT_INVALID');
const status=document.querySelector('.startup-status'),message=document.querySelector('[data-message]'),detail=document.querySelector('[data-detail]'),code=document.querySelector('[data-code]');
let current:StartupState|null=null,disposed=false,failed:StartupFailure|null=null,firstEnded=false,firstFrame=false,reduced=false,released=false;
let frameCallback:number|undefined,fadeDeadline:number|undefined,releasingGeneration:number|undefined;
let waitingForPlay=false,playAttempt=0,lastTime=0,lastTick=performance.now(),withoutFrame=0,withoutProgress=0,resumeTime:number|null=null;
const motion=matchMedia('(prefers-reduced-motion: reduce)');
video.muted=true;
// Only a genuine ended event may complete the normal first play. Fault clocks never do.
const emit=(value:StartupSignal)=>{if(!disposed)void window.desktopStartup.event(value).catch(()=>{});};
const playable=()=>!!current?.active&&!current.releasing&&!document.hidden&&!failed&&!reduced&&!disposed;
const diagnostics=(reason:StartupFailure|'reduced-motion')=>{
  status?.removeAttribute('hidden');
  if(message)message.textContent=reason==='reduced-motion'?'已减少启动动态效果':'启动视频暂时无法播放';
  if(detail)detail.textContent=reason==='reduced-motion'?'正在准备登录界面。':'正在继续准备登录，稍后将显示登录页或连接恢复选项。';
  if(code)code.textContent=reason==='reduced-motion'?'REDUCED_MOTION':('STARTUP_'+reason.replaceAll('-','_').toUpperCase());
};
const fail=(reason:StartupFailure)=>{
  if(disposed||failed||current?.releasing)return;
  failed=reason;video.pause();document.body.dataset.failed='true';document.body.dataset.startupFailure=reason;
  diagnostics(reason);emit({version:1,type:'failed',reason});
};
const play=()=>{
  if(!playable()||waitingForPlay||!video.paused)return;
  if(resumeTime!==null){video.currentTime=resumeTime;resumeTime=null;}
  waitingForPlay=true;const attempt=++playAttempt;
  void video.play().catch(()=>{if(attempt===playAttempt&&playable())fail('play-rejected');}).finally(()=>{if(attempt===playAttempt)waitingForPlay=false;});
};
const sync=()=>{
  // Native active also accounts for Windows lock/suspend; Page Visibility alone does not.
  lastTick=performance.now();lastTime=video.currentTime;
  if(!playable()){playAttempt++;waitingForPlay=false;video.pause();return;}
  play();
};
const showFirstFrame=()=>{
  if(disposed||firstFrame||failed||reduced)return;
  firstFrame=true;document.body.dataset.firstFrame='true';emit({version:1,type:'first-frame'});
};
video.addEventListener('loadedmetadata',()=>{
  if(!Number.isFinite(video.duration)||video.duration<=0||video.videoWidth<=0||video.videoHeight<=0){fail('media-error');return;}
  document.body.dataset.metadata='true';
  emit({version:1,type:'metadata',duration:video.duration,width:video.videoWidth,height:video.videoHeight});
});
frameCallback=video.requestVideoFrameCallback(showFirstFrame);
video.addEventListener('playing',()=>{document.body.dataset.playback='playing';withoutProgress=0;emit({version:1,type:'playing'});if(!playable())video.pause();});
for(const type of ['waiting','stalled'] as const)video.addEventListener(type,()=>{document.body.dataset.playback=type;emit({version:1,type});});
video.addEventListener('error',()=>{document.body.dataset.mediaError=String(video.error?.code??0);fail('media-error');});
video.addEventListener('ended',()=>{
  if(!playable()){
    // An ended dispatch queued across hiding must not count as a visible complete play.
    resumeTime=Math.max(0,Math.min(lastTime,video.duration-.15));return;
  }
  if(!firstEnded||!current?.firstPlaybackComplete){firstEnded=true;document.body.dataset.firstEnded='true';emit({version:1,type:'first-ended'});}
  // loop=true suppresses ended. Keep this same element and manually continue it instead.
  video.currentTime=0;lastTime=0;withoutProgress=0;play();
});
const release=(generation:number)=>{
  if(released||disposed||!current?.releasing||current.generation!==generation)return;released=true;
  clearTimeout(fadeDeadline);video.pause();emit({version:1,type:'released',generation});
};
document.body.addEventListener('transitionend',event=>{if(event.target===document.body&&event.propertyName==='opacity'&&releasingGeneration!==undefined&&Number(getComputedStyle(document.body).opacity)<.001)release(releasingGeneration);});
const render=(state:StartupState)=>{
  if(disposed)return;
  current=state;
  document.body.dataset.firstPlaybackComplete=String(state.firstPlaybackComplete);
  if((state.reducedMotion||motion.matches)&&!reduced){reduced=true;video.pause();document.body.dataset.reducedMotion='true';diagnostics('reduced-motion');emit({version:1,type:'reduced-motion'});}
  if(state.failure&&!failed){failed=state.failure;document.body.dataset.failed='true';document.body.dataset.startupFailure=state.failure;diagnostics(state.failure);}
  if(!state.releasing){clearTimeout(fadeDeadline);delete document.body.dataset.releasing;releasingGeneration=undefined;released=false;}
  if(state.releasing&&!document.body.dataset.releasing){
    const generation=state.generation;releasingGeneration=generation;
    document.body.dataset.releasing='true';video.pause();
    if(reduced||matchMedia('(prefers-reduced-motion: reduce)').matches)release(generation);
    // Only safeguards fade cleanup when a transition event is lost, never video completion.
    else fadeDeadline=window.setTimeout(()=>release(generation),320);
  }
  sync();
};
let received=false;
const unsubscribe=window.desktopStartup.onState(state=>{received=true;render(state);});
void window.desktopStartup.state().then(state=>{if(!received)render(state);}).catch(()=>fail('overlay-load-failed'));
const visibilityChanged=()=>{emit({version:1,type:'visibility',visible:!document.hidden});sync();};
document.addEventListener('visibilitychange',visibilityChanged);visibilityChanged();
const motionChanged=()=>{if(current)render(current);};motion.addEventListener('change',motionChanged);
const watchdog=window.setInterval(()=>{
  const now=performance.now(),delta=Math.min(1000,Math.max(0,now-lastTick));lastTick=now;
  if(!playable())return;
  // Accumulate visible ticks so a suspended wall clock cannot be mistaken for a fault.
  if(!firstFrame)withoutFrame+=delta;
  if(video.currentTime>lastTime+.001){withoutProgress=0;lastTime=video.currentTime;}else withoutProgress+=delta;
  if(withoutFrame>=8000)fail('first-frame-timeout');else if(withoutProgress>=8000)fail('playback-stalled');
},250);
window.addEventListener('pagehide',()=>{
  disposed=true;video.pause();clearInterval(watchdog);clearTimeout(fadeDeadline);unsubscribe();document.removeEventListener('visibilitychange',visibilityChanged);
  motion.removeEventListener('change',motionChanged);
  if(frameCallback!==undefined)video.cancelVideoFrameCallback(frameCallback);
},{once:true});
