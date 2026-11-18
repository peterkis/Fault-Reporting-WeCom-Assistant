import {invalidateMotionTokens,setMotionPreferenceOverride} from './tokens';

/** Imported only behind import.meta.env.DEV; never emitted by the production build. */
export function installMotionDebug(){
  const root=document.documentElement;
  const styles=getComputedStyle(root);
  const original=new Map(Array.from(styles).filter(key=>key.startsWith('--dur-')).map(key=>[key,styles.getPropertyValue(key).trim()] as const));
  let previous:string|null|undefined;
  const apply=()=>{
    let stored:string|null=null;try{stored=localStorage.getItem('motion-debug');}catch{/* URL override works without storage. */}
    const mode=new URLSearchParams(location.search).get('motion')??stored;
    if(mode===previous)return;previous=mode;
    for(const [key,value] of original)root.style.setProperty(key,mode==='slow'?`${parseFloat(value)*(value.endsWith('ms')?1:1000)*5}ms`:value);
    if(mode==='slow'||mode==='off')root.dataset.motion=mode;else delete root.dataset.motion;
    setMotionPreferenceOverride(mode==='off');invalidateMotionTokens();
  };
  apply();window.addEventListener('storage',apply);window.addEventListener('popstate',apply);
  // Same-document setItem emits no storage event. This wrapper exists only in the dev chunk.
  const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
  Storage.prototype.setItem=function(key,value){set.call(this,key,value);if(this===localStorage&&key==='motion-debug')apply();};
  Storage.prototype.removeItem=function(key){remove.call(this,key);if(this===localStorage&&key==='motion-debug')apply();};
}
