import {createContext,createElement,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {confirmedReceipt} from '../lib/command';
import {ApiError,isConflict,isUnknownResult,captureAuthGeneration} from '../api/client';

export interface Command {
 id:string;
 requestRef?:string;
 execute:()=>Promise<unknown>;
 recover:()=>Promise<unknown>;
 /** The transport validates its DTO; this ties a receipt to this command's intent. */
 confirm?:(result:unknown,phase:'execute'|'recover')=>boolean;
 success:(result:unknown)=>Promise<void>|void;
}
type CommandState=
 | {status:'idle'}
 | {status:'pending';id:string}
 | {status:'unknown';id:string;error:unknown;checked:boolean;recovering:boolean}
 | {status:'conflict';id:string;error:unknown}
 | {status:'rejected';error:unknown}
 | {status:'committed';id:string;requestRef:string|null;synchronizing:boolean;syncError:unknown|null};
export type CommandStatus=CommandState['status'];
export type CommandSnapshot=CommandState & {
 error:unknown;checked:boolean;busy:boolean;blocked:boolean;id:string|undefined;
 requestRef:string|null;synchronizing:boolean;syncError:unknown|null;syncingRequests:readonly string[];
};
export interface CommandActions {
 run:(command:Command)=>Promise<void>;
 recover:()=>Promise<void>;
 reset:()=>void;
 acknowledgeSync:(requestRef:string)=>void;
}
export type CommandController=CommandSnapshot & CommandActions;
const StateContext=createContext<CommandSnapshot|null>(null);
const ActionsContext=createContext<CommandActions|null>(null);
function currentGeneration(generation:number):void{if(generation!==captureAuthGeneration())throw new DOMException('Command scope changed','AbortError');}

export function CommandProvider({children}:{children:ReactNode}){
 const current=useRef<Command|null>(null),alive=useRef(true),sequence=useRef(0),recovering=useRef(false),conflicted=useRef(false);
 const [state,setState]=useState<CommandState>({status:'idle'});
 const [syncingRequests,setSyncingRequests]=useState<readonly string[]>([]);
 const acknowledgeSync=useCallback((ref:string)=>{
  setSyncingRequests(previous=>previous.filter(value=>value!==ref));
  setState(previous=>previous.status==='committed'&&previous.requestRef===ref?{...previous,synchronizing:false,syncError:null}:previous);
 },[]);
 const commit=useCallback((command:Command,result:unknown,turn:number,generation:number)=>{
  currentGeneration(generation);
  current.current=null;
  conflicted.current=false;
  document.documentElement.removeAttribute('data-h5-command-pending');
  const requestRef=command.requestRef;
  if(requestRef)setSyncingRequests(previous=>previous.includes(requestRef)?previous:[...previous,requestRef]);
  setState({status:'committed',id:command.id,requestRef:requestRef??null,synchronizing:true,syncError:null});
  // A confirmed write is complete. Refresh/navigation errors cannot turn it into UNKNOWN.
  void Promise.resolve().then(()=>{if(alive.current){currentGeneration(generation);return command.success(result);}}).then(()=>{
   if(!alive.current)return;
   if(requestRef)setSyncingRequests(previous=>previous.filter(ref=>ref!==requestRef));
   if(sequence.current===turn)setState({status:'committed',id:command.id,requestRef:requestRef??null,synchronizing:false,syncError:null});
  },reason=>{
   if(alive.current&&sequence.current===turn)setState({status:'committed',id:command.id,requestRef:requestRef??null,synchronizing:false,syncError:reason});
  });
 },[]);
 const run=useCallback(async(command:Command)=>{
  if(current.current||!alive.current)return;
  conflicted.current=false;
  current.current=command;const turn=++sequence.current,generation=captureAuthGeneration();
  document.documentElement.dataset.h5CommandPending='true';
  setState({status:'pending',id:command.id});
  try{
   const result=await command.execute();
   if(!alive.current||current.current!==command)return;
   currentGeneration(generation);
   if(command.confirm&&!command.confirm(result,'execute'))throw new ApiError(502,'INVALID_RECEIPT');
   commit(command,result,turn,generation);
  }catch(reason){
   if(!alive.current||current.current!==command)return;
   if(isConflict(reason)){conflicted.current=true;setState({status:'conflict',id:command.id,error:reason});}
   else if(isUnknownResult(reason))setState({status:'unknown',id:command.id,error:reason,checked:false,recovering:false});
   else{current.current=null;document.documentElement.removeAttribute('data-h5-command-pending');setState({status:'rejected',error:reason});}
  }
 },[commit]);
 const recover=useCallback(async()=>{
  const command=current.current;if(!command||recovering.current||!alive.current)return;
  recovering.current=true;const turn=sequence.current,generation=captureAuthGeneration();
  setState(previous=>previous.status==='unknown'?{...previous,checked:false,recovering:true}:previous);
  try{
   const result=await command.recover();
   if(!alive.current||current.current!==command)return;
   currentGeneration(generation);
   const confirmed=command.confirm?command.confirm(result,'recover'):confirmedReceipt(result,command.id);
   if(confirmed)commit(command,result,turn,generation);
   else setState({status:'unknown',id:command.id,error:null,checked:true,recovering:false});
  }catch(reason){
   if(!alive.current||current.current!==command)return;
   if(reason instanceof ApiError&&(reason.status===401||reason.status===403)){
    current.current=null;document.documentElement.removeAttribute('data-h5-command-pending');setState({status:'rejected',error:reason});
   }else setState({status:'unknown',id:command.id,error:reason,checked:false,recovering:false});
  }finally{recovering.current=false;}
 },[commit]);
 const reset=useCallback(()=>{
  if(!conflicted.current)return;
  conflicted.current=false;current.current=null;document.documentElement.removeAttribute('data-h5-command-pending');setState({status:'idle'});
 },[]);
 useEffect(()=>{
  alive.current=true;
  const protect=(event:BeforeUnloadEvent)=>{if(current.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',protect);
  return()=>{alive.current=false;current.current=null;window.removeEventListener('beforeunload',protect);document.documentElement.removeAttribute('data-h5-command-pending');};
 },[]);
 const actions=useMemo<CommandActions>(()=>({run,recover,reset,acknowledgeSync}),[run,recover,reset,acknowledgeSync]);
 const snapshot=useMemo<CommandSnapshot>(()=>{
  const derived={error:'error'in state?state.error:null,checked:state.status==='unknown'&&state.checked,
   busy:state.status==='pending'||(state.status==='unknown'&&state.recovering),
   blocked:state.status==='pending'||state.status==='unknown'||state.status==='conflict',
   requestRef:state.status==='committed'?state.requestRef:null,
   synchronizing:state.status==='committed'&&state.synchronizing,
   syncError:state.status==='committed'?state.syncError:null,syncingRequests};
  return 'id'in state?{...state,...derived}:{...state,id:undefined,...derived};
 },[state,syncingRequests]);
 return createElement(ActionsContext.Provider,{value:actions},createElement(StateContext.Provider,{value:snapshot},children));
}
export function useCommandActions():CommandActions{const value=useContext(ActionsContext);if(!value)throw new Error('Member command scope required');return value;}
export function useCommandSnapshot():CommandSnapshot{const value=useContext(StateContext);if(!value)throw new Error('Member command scope required');return value;}
/** Compatibility facade for the recovery notice; leaf actions can subscribe separately. */
export function useCommand():CommandController{return {...useCommandSnapshot(),...useCommandActions()};}
