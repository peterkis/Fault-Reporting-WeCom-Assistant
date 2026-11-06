import '../design/fonts.css';
import * as ww from '@wecom/jssdk';
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {Ellipsis} from 'lucide-react';
import type {LoginBridge,LoginPrepared} from '../../desktop/policy.mjs';
import './login.css';
declare global {interface Window {workbenchLogin?:LoginBridge}}

const root=document.getElementById('desktop-login');
const status=document.getElementById('login-status');
const button=document.getElementById('restart-login');
const retryButton=document.getElementById('retry-login');
const panelHost=document.getElementById('wecom-panel');
const frontHint=document.getElementById('login-gesture');
const stage=document.getElementById('lanyard-stage');
const viewButton=document.getElementById('switch-login-view');
const moreButton=document.getElementById('login-more');
const moreIcon=document.getElementById('login-more-icon');
const options=document.getElementById('login-options-menu');
const quitButton=document.getElementById('quit-desktop');
if(!root||!status||!button||!retryButton||!panelHost||!frontHint||!stage||!viewButton||!moreButton||!moreIcon||!options||!quitButton)throw Error('LOGIN_DOCUMENT_INVALID');
const {corpId,agentId,state,issued,expires,callback}=root.dataset;
const expiry=Number(expires),issuance=Number(issued),ttl=expiry-issuance;
if(!corpId||!agentId||!/^\d{1,20}$/u.test(agentId)||!state?.startsWith('desktop.')||!Number.isSafeInteger(expiry)||!Number.isSafeInteger(issuance)||ttl!==300_000||!callback)throw Error('LOGIN_PARAMETERS_INVALID');
// Include HTML and bundle loading in the waiting budget, rather than starting a new five minutes after JS loads.
const wallStart=performance.timeOrigin,steadyStart=0;
const elapsed=()=>Math.max(0,Date.now()-wallStart,performance.now()-steadyStart);
const callbackURL=new URL(callback);
if(callbackURL.origin!==location.origin||callbackURL.pathname!=='/workbench/callback'||callbackURL.search||callbackURL.hash)throw Error('LOGIN_CALLBACK_INVALID');
let active=true,completing=false;
let panel:ReturnType<typeof ww.createWWLoginPanel>|null=null;
let timer:number|undefined;
let readyTimer:number|undefined;
let scene:ReturnType<typeof createRoot>|null=null;
let backdrop:ReturnType<typeof createRoot>|null=null,backdropRequested=false;
let renderBackdrop:(()=>void)|null=null;
let backgroundMode:'pending'|'shader'|'fallback'='pending',presentationStarted=false;
let cardPrepared=false,scenePrepared=false,sceneReleased=false;
let panelState:'pending'|'created'|'failed'='pending';
let backgroundTimer:number|undefined;
let bridgeTimer:number|undefined,stopPresented:(()=>void)|undefined;
const nativeLogin=window.workbenchLogin?.version===1?window.workbenchLogin:undefined;
const nativeStartup=nativeLogin?.startup?.version===1?nativeLogin.startup:undefined;
if(nativeStartup?.connect){
  const unavailable=()=>{if(active&&!completing)document.body.dataset.startupCompatibility='bridge-connect-rejected';};
  try{void nativeStartup.connect().catch(unavailable);}catch{unavailable();}
}
let presentationAllowed=!nativeStartup,preparedReported=false;
document.body.dataset.loginPresentation=nativeStartup?'waiting':'legacy';
const setSceneInert=(value:boolean)=>{
  for(const element of [root,document.querySelector('.login-options'),options])if(element instanceof HTMLElement)element.inert=value;
};
if(nativeStartup)setSceneInert(true);
const allowPresentation=(reason?:string)=>{
  if(!active||completing)return;
  presentationAllowed=true;clearTimeout(bridgeTimer);
  if(reason)document.body.dataset.startupCompatibility=reason;
  revealScene();
};
const revealScene=()=>{
  if(sceneReleased||!cardPrepared||backgroundMode==='pending'||!active||completing)return;
  if(!scenePrepared){scenePrepared=true;document.body.dataset.loginScene='prepared';}
  if(nativeStartup&&!preparedReported){
    preparedReported=true;
    const value:LoginPrepared={version:1,panel:panelState==='failed'?'failed':'created',backdrop:backgroundMode};
    // Only a missing acknowledgement is a compatibility failure. An accepted preparation
    // may legitimately wait while the native first playback is paused by a hidden window.
    bridgeTimer=window.setTimeout(()=>allowPresentation('bridge-timeout'),8000);
    try{
      void nativeStartup.prepared(value).then(result=>{
        if(!active||completing)return;
        if(!result||typeof result.presented!=='boolean'){allowPresentation('bridge-response-invalid');return;}
        clearTimeout(bridgeTimer);
        if(result.presented)allowPresentation();
      }).catch(()=>allowPresentation('bridge-rejected'));
    }catch{allowPresentation('bridge-rejected');}
  }
  if(sceneReleased||!presentationAllowed)return;
  sceneReleased=true;document.body.dataset.loginScene='ready';document.body.dataset.loginPresentation='presented';setSceneInert(false);renderScene?.();renderBackdrop?.();
};
const finishBackdrop=(mode:'shader'|'fallback',reason?:string)=>{
  if(!active||completing)return;
  if(reason)document.body.dataset.backdropReason=reason;
  if(backgroundMode!=='pending'){
    if(mode==='fallback'){document.body.dataset.backdrop='fallback';queueMicrotask(()=>{backdrop?.unmount();backdrop=null;});}
    return;
  }
  backgroundMode=mode;clearTimeout(backgroundTimer);document.body.dataset.backdrop=mode;
  if(mode==='fallback')queueMicrotask(()=>{backdrop?.unmount();backdrop=null;});
  startPresentation();
  revealScene();
};
const armBackgroundTimer=()=>{clearTimeout(backgroundTimer);if(backgroundMode==='pending'&&!document.hidden)backgroundTimer=window.setTimeout(()=>finishBackdrop('fallback','timeout'),8000);};
const mountBackdrop=()=>{
  const host=document.getElementById('login-backdrop');
  if(backdropRequested||!active||completing||document.hidden||innerWidth===0)return;
  backdropRequested=true;
  if(!host||!('gpu' in navigator)||!navigator.gpu){finishBackdrop('fallback','unsupported');return;}
  if(!matchMedia('(min-width: 801px)').matches){finishBackdrop('fallback','narrow');return;}
  armBackgroundTimer();
  void import('./LoginBackdrop').then(({default:LoginBackdrop})=>{
    if(!active||completing||backgroundMode!=='pending')return;
    backdrop=createRoot(host,{onUncaughtError:()=>finishBackdrop('fallback','component-error')});
    renderBackdrop=()=>{if(active&&!completing)backdrop?.render(createElement(LoginBackdrop,{presented:sceneReleased,onReady:()=>finishBackdrop('shader'),onUnavailable:(reason:string)=>finishBackdrop('fallback',reason)}));};
    renderBackdrop();
  }).catch(()=>finishBackdrop('fallback','import-failed'));
};
let appVersion='',renderScene:(()=>void)|null=null;
if(nativeStartup){
  try{stopPresented=nativeStartup.onPresented(()=>allowPresentation());}
  catch{presentationAllowed=true;document.body.dataset.startupCompatibility='bridge-listener-unavailable';setSceneInert(false);}
}
if(nativeLogin){
  quitButton.hidden=false;
  quitButton.addEventListener('click',()=>{
    if(!active||completing)return;quitButton.setAttribute('disabled','');if(options.matches(':popover-open'))options.hidePopover();
    void nativeLogin.quit().catch(()=>{if(active&&!completing){quitButton.removeAttribute('disabled');status.textContent='退出程序未完成，请重试。';}});
  });
  void nativeLogin.getAppVersion().then(value=>{
    if(!active||completing||typeof value!=='string'||value.length>48||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value))return;
    appVersion=value;root.dataset.appVersion=value;renderScene?.();
  }).catch(()=>{});
}
let icon:ReturnType<typeof createRoot>|null=createRoot(moreIcon);
icon.render(createElement(Ellipsis,{size:18,strokeWidth:1.75,'aria-hidden':true}));
options.addEventListener('toggle',()=>moreButton.setAttribute('aria-expanded',String(options.matches(':popover-open'))));
// The old key also stored automatic fallbacks; its origin cannot be recovered reliably.
const modeKey='workbench-login-view-v2';
const fallbackKey='workbench-login-fallback-once';
type FallbackReason='webgl-unavailable'|'context-lost'|'scene-error'|'asset-failed'|'startup-timeout'|'scale';
const fallbackReasons:readonly string[]=['webgl-unavailable','context-lost','scene-error','asset-failed','startup-timeout','scale'];
const supportedScale=()=>window.devicePixelRatio===1&&(!window.visualViewport||Math.abs(window.visualViewport.scale-1)<0.001);
let preferredView:string|null=null,temporaryFallback:string|null=null;
try{preferredView=sessionStorage.getItem(modeKey);temporaryFallback=sessionStorage.getItem(fallbackKey);sessionStorage.removeItem(fallbackKey);sessionStorage.removeItem('workbench-login-view');}catch{/* A denied preference store does not prevent login. */}
if(!fallbackReasons.includes(temporaryFallback??''))temporaryFallback=null;
const view=preferredView==='flat'||temporaryFallback||!supportedScale()?'flat':'lanyard';
root.dataset.view=view;
root.dataset.pageHidden=String(document.hidden);
if(temporaryFallback)root.dataset.fallbackReason=temporaryFallback;
viewButton.textContent=view==='flat'?'使用工牌视图':'使用平面扫码';
if(!supportedScale()){viewButton.hidden=true;status.textContent='当前缩放使用平面扫码。';}
const dispose=()=>{clearTimeout(timer);clearTimeout(readyTimer);clearTimeout(backgroundTimer);clearTimeout(bridgeTimer);stopPresented?.();stopPresented=undefined;panel?.unmount();panel=null;scene?.unmount();scene=null;backdrop?.unmount();backdrop=null;icon?.unmount();icon=null;};
const restart=()=>{if(!active||completing)return;active=false;dispose();location.replace('/workbench/desktop/embedded');};
const changeView=(next:'flat'|'lanyard',automaticReason?:FallbackReason)=>{
  if(!active||completing)return;
  // Never reparent an active cross-origin iframe. A new view gets a fresh server intent.
  try{
    if(automaticReason)sessionStorage.setItem(fallbackKey,automaticReason);
    else{sessionStorage.setItem(modeKey,next);sessionStorage.removeItem(fallbackKey);}
  }catch{active=false;dispose();location.assign('/workbench/desktop');return;}
  restart();
};
const armReadyTimer=()=>{clearTimeout(readyTimer);if(view==='lanyard'&&active&&!completing&&panelState==='pending'&&!document.hidden)readyTimer=window.setTimeout(()=>changeView('flat','startup-timeout'),15_000);};
button.addEventListener('click',restart);
retryButton.addEventListener('click',restart);
viewButton.addEventListener('click',()=>changeView(view==='flat'?'lanyard':'flat'));
const mountPanel=()=>{
if(!active||completing||panelState!=='pending'||!panelHost.isConnected)return;
clearTimeout(readyTimer);
if(elapsed()>=ttl-60_000){restart();return;}
const panelFailed=()=>{
  if(!active||completing)return;
  panelState='failed';root.dataset.loginPanel='failed';
  status.textContent='企业微信登录面板未能加载，请重新获取二维码，或使用官方登录页。';
};
try{
  panel=ww.createWWLoginPanel({el:panelHost,params:{login_type:ww.WWLoginType.corpApp,appid:corpId,agentid:agentId,redirect_uri:callbackURL.href,state,redirect_type:ww.WWLoginRedirectType.callback,panel_size:ww.WWLoginPanelSizeType.small,lang:ww.WWLoginLangType.zh},
    onLoginSuccess({code}){
      if(!active||completing)return;
      if(elapsed()>=ttl){restart();return;}
      if(typeof code!=='string'||!code||new TextEncoder().encode(code).length>512){status.textContent='登录响应无效，请重新获取二维码。';return;}
      completing=true;clearTimeout(timer);status.textContent='正在核验工作台权限…';button.setAttribute('disabled','');
      retryButton.setAttribute('disabled','');
      viewButton.setAttribute('disabled','');
      moreButton.setAttribute('disabled','');if(options.matches(':popover-open'))options.hidePopover();
      quitButton.setAttribute('disabled','');
      const target=new URL(callbackURL);target.searchParams.set('code',code);target.searchParams.set('state',state);location.assign(target.href);
    },
    onLoginFail(){panelFailed();},
  });
  if(panelState==='pending'){
    panelState='created';root.dataset.loginPanel='created';
    // The SDK exposes no QR-rendered callback. An iframe, including its load event,
    // only proves panel creation; it does not prove a visible or scannable QR code.
    status.textContent='如未显示二维码，请重新获取，或使用官方登录页。';
  }
}catch{
  panelFailed();
  // A failed initializer must leave useful content inside the card, rather than
  // treating the finally block as evidence of a successfully loaded QR panel.
  const message=document.createElement('div'),title=document.createElement('p'),description=document.createElement('p');
  message.className='login-panel-failure';message.setAttribute('role','status');
  title.textContent='企业微信登录面板加载失败';description.textContent='请使用工牌下方的“重新获取二维码”或“使用官方登录页”。';message.append(title,description);panelHost.replaceChildren(message);
}
cardPrepared=true;revealScene();
};
const lanyardModule=view==='lanyard'?import('./Lanyard'):null;
void lanyardModule?.catch(()=>{});
function startPresentation(){
  if(!stage||!panelHost||!frontHint)return;
  if(presentationStarted||!active||completing)return;presentationStarted=true;
  if(view==='flat'){mountPanel();return;}
  armReadyTimer();
  void lanyardModule?.then(({default:Lanyard})=>{
    if(!active||completing)return;
    const fallback=(reason:FallbackReason)=>queueMicrotask(()=>changeView('flat',reason));
    scene=createRoot(stage,{onUncaughtError:()=>fallback('scene-error')});
    renderScene=()=>{if(active&&!completing)scene?.render(createElement(Lanyard,{frontElement:panelHost,frontHint,viewportFrame:stage,presentationReady:sceneReleased,onFrontReady:mountPanel,onFallback:fallback,cornerRadius:0.35,strapLength:0.6,strapColor:'#3b82f6',strapWidth:0.85,breeze:0,backLabel:appVersion?'v'+appVersion:''}));};
    renderScene();
  }).catch(()=>changeView('flat','asset-failed'));
}
startPresentation();requestAnimationFrame(mountBackdrop);
// The public page is also usable outside Electron. Each refresh renews the full server intent.
timer=window.setTimeout(restart,Math.max(1,ttl-elapsed()-60_000));
const resume=()=>{if(elapsed()>=ttl-60_000)restart();};
window.addEventListener('focus',resume);window.addEventListener('online',resume);
const networkState=()=>{document.body.dataset.offline=String(!navigator.onLine);};
networkState();window.addEventListener('offline',networkState);window.addEventListener('online',networkState);
// CSS3D supports only 100% browser/display zoom. Preserve desktop zoom and use the flat view.
const checkScale=()=>{viewButton.hidden=!supportedScale();if(view==='lanyard'&&!supportedScale())changeView('flat','scale');};
window.addEventListener('resize',checkScale);
window.visualViewport?.addEventListener('resize',checkScale);
// Native resume checks the trusted main response's Cookie lifetime. Page guards coalesce this with its own timer.
window.addEventListener('workbench-login-expired',restart);
document.addEventListener('visibilitychange',()=>{root.dataset.pageHidden=String(document.hidden);clearTimeout(readyTimer);clearTimeout(backgroundTimer);if(document.visibilityState==='visible'){resume();armReadyTimer();mountBackdrop();armBackgroundTimer();}});
window.addEventListener('pagehide',()=>{active=false;dispose();},{once:true});
