import type {ChromeBridge,ChromeState,ChromeAction} from './policy.mjs';
declare global {interface Window {desktopChrome:ChromeBridge}}
const maximize=document.getElementById('maximize');
function render(state:ChromeState){
  const version=document.querySelector('.surface-name');if(version)version.textContent='v'+state.appVersion;
  document.body.dataset.maximized=String(state.maximized);document.body.dataset.focused=String(state.focused);
  document.body.dataset.booting=String(state.booting);
  document.querySelector('[data-startup]')?.toggleAttribute('hidden',!state.booting||!!state.recovery);
  document.querySelector('[data-recovery]')?.toggleAttribute('hidden',!state.recovery);
  document.querySelector('[data-session-notice]')?.toggleAttribute('hidden',!state.loginExpired);
  const title=document.querySelector('[data-connection-title]'),description=document.querySelector('[data-connection-description]');
  if(title)title.textContent=state.recovery==='failed'?'页面暂时无法恢复':state.recovery==='reconnecting'?'正在重新连接':state.recovery==='unavailable'?'暂时无法连接':'应用已离线';
  if(description)description.textContent=state.recovery==='failed'?'页面多次中断，请尝试重新连接。':state.recovery==='reconnecting'?'正在重新打开刚才的页面，请稍候。':state.recovery==='unavailable'?'暂时无法连接服务，正在自动重试。也可以检查网络后重新连接。':'请检查网络连接。连接恢复后，将自动重新打开刚才的页面。';
  const retry=document.getElementById('reconnect');if(retry instanceof HTMLButtonElement){retry.disabled=state.recovery==='reconnecting';retry.textContent=retry.disabled?'正在连接…':'重新连接';}
  maximize?.setAttribute('aria-label',state.maximized?'还原窗口':'最大化');maximize?.setAttribute('title',state.maximized?'还原窗口':'最大化');
  document.getElementById('menu')?.setAttribute('aria-expanded',String(state.menuOpen));
}
let received=false;window.desktopChrome.onState(state=>{received=true;render(state);});void window.desktopChrome.state().then(state=>{if(!received)render(state);});
for(const action of ['menu','minimize','maximize','close','reconnect'] satisfies ChromeAction[]){document.getElementById(action)?.addEventListener('click',()=>{void window.desktopChrome.command(action);});}
// The local parent remains alive when the remote login renderer fails or crashes.
if(document.body.classList.contains('app-chrome'))window.addEventListener('online',()=>{void window.desktopChrome.command('reconnect');});
