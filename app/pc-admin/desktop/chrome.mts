import type {ChromeBridge,ChromeState,ChromeAction} from './policy.mjs';
declare global {interface Window {desktopChrome:ChromeBridge}}
const maximize=document.getElementById('maximize');
function render(state:ChromeState){
  document.body.dataset.maximized=String(state.maximized);document.body.dataset.focused=String(state.focused);
  maximize?.setAttribute('aria-label',state.maximized?'还原窗口':'最大化');maximize?.setAttribute('title',state.maximized?'还原窗口':'最大化');
  document.getElementById('menu')?.setAttribute('aria-expanded',String(state.menuOpen));
}
let received=false;window.desktopChrome.onState(state=>{received=true;render(state);});void window.desktopChrome.state().then(state=>{if(!received)render(state);});
for(const action of ['menu','minimize','maximize','close'] satisfies ChromeAction[]){document.getElementById(action)?.addEventListener('click',()=>{void window.desktopChrome.command(action);});}
