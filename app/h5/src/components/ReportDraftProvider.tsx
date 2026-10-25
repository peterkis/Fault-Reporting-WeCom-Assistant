import {createContext,useContext,useEffect,useMemo,useRef,useSyncExternalStore,type ReactNode} from 'react';
import {useSession} from '../session';
import {authLost} from '../api/client';
import {useMedia,type MediaController,type VoiceTranscriptEvent} from '../hooks/useMedia';

function createDraft(){
 let description='',location='',error:string|null=null,hasMedia=false,edit=0,voice:{id:string;edit:number;text:string|null}|null=null;
 const listeners=new Set<()=>void>();
 const dirty=()=>Boolean(description||location||hasMedia);
 const mark=()=>{if(dirty())document.documentElement.dataset.h5Draft='true';else document.documentElement.removeAttribute('data-h5-draft');};
 const emit=()=>{mark();for(const listener of listeners)listener();};
 return {
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
  getDescription:()=>description,getLocation:()=>location,getError:()=>error,isDirty:dirty,
  setDescription:(value:string)=>{description=value;edit+=1;emit();},setLocation:(value:string)=>{location=value;emit();},setError:(value:string|null)=>{error=value;emit();},
  setHasMedia:(value:boolean)=>{if(hasMedia!==value){hasMedia=value;mark();}},
  transcript:(event:VoiceTranscriptEvent)=>{
   if(event.type==='BEGIN'){if(voice&&voice.text!==null&&voice.edit===edit&&description===voice.text){description='';emit();}voice={id:event.id,edit,text:null};}
   else if(voice?.id===event.id){
    if(event.type==='READY'){if(voice.edit===edit&&!description){description=event.text.slice(0,2000);voice.text=description;emit();}}
    else{if(voice.text!==null&&voice.edit===edit&&description===voice.text){description='';emit();}voice=null;}
   }
  },
  clear:()=>{description='';location='';error=null;voice=null;edit+=1;emit();},
 };
}
type DraftStore=ReturnType<typeof createDraft>;
interface DraftContext {draft:DraftStore;media:MediaController}
const Context=createContext<DraftContext|null>(null);
export function ReportDraftProvider({children}:{children:ReactNode}){
 const session=useSession(),draftRef=useRef<DraftStore|null>(null);
 if(!draftRef.current)draftRef.current=createDraft();
 const draft=draftRef.current,media=useMedia(session,draft.transcript);
 const value=useMemo(()=>({draft,media}),[draft,media]);
 useEffect(()=>{
  const update=()=>draft.setHasMedia(media.getItems().length>0),unsubscribe=media.subscribe(update);update();
  const protect=(event:BeforeUnloadEvent)=>{if(draft.isDirty()){event.preventDefault();event.returnValue='';}};
  const clear=()=>{draft.setHasMedia(false);draft.clear();};
  authLost.addEventListener('lost',clear);authLost.addEventListener('scope-change',clear);
  window.addEventListener('beforeunload',protect);
  return()=>{unsubscribe();authLost.removeEventListener('lost',clear);authLost.removeEventListener('scope-change',clear);window.removeEventListener('beforeunload',protect);document.documentElement.removeAttribute('data-h5-draft');};
 },[draft,media]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useReportDraft(){const context=useContext(Context);if(!context)throw new Error('Report draft scope required');return context;}
export function useDraftDescription(){const {draft}=useReportDraft();return useSyncExternalStore(draft.subscribe,draft.getDescription,draft.getDescription);}
export function useDraftLocation(){const {draft}=useReportDraft();return useSyncExternalStore(draft.subscribe,draft.getLocation,draft.getLocation);}
export function useDraftError(){const {draft}=useReportDraft();return useSyncExternalStore(draft.subscribe,draft.getError,draft.getError);}
