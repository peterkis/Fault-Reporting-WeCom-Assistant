import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {confirmedReceipt} from '../lib/command';
import { ApiError,isConflict,isUnknownResult } from '../api/client';
export interface Command {id:string;execute:()=>Promise<unknown>;recover:()=>Promise<unknown>;success:(result:unknown)=>Promise<void>|void}
export type CommandStatus='idle'|'pending'|'unknown'|'conflict'|'rejected';

function useCommandState(){
  const current=useRef<Command|null>(null);
  useEffect(()=>()=>{current.current=null;},[]);
  const [status,setStatus]=useState<CommandStatus>('idle');
  const [error,setError]=useState<unknown>(null);
  const [checked,setChecked]=useState(false);
  useEffect(()=>{const protect=(event:BeforeUnloadEvent)=>{if(current.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[]);
  const mutation=useMutation({retry:false,mutationFn:(command:Command)=>command.execute()});
  const recovery=useMutation({retry:false,mutationFn:(command:Command)=>command.recover()});
  const run=async(command:Command)=>{
    if(current.current)return;
    current.current=command;setStatus('pending');setError(null);setChecked(false);
    try{const result=await mutation.mutateAsync(command);if(current.current!==command)return;await command.success(result);current.current=null;setStatus('idle');}
    catch(reason){if(current.current!==command)return;setError(reason);if(isConflict(reason)){setStatus('conflict');}else if(isUnknownResult(reason)){setStatus('unknown');}else{current.current=null;setStatus('rejected');}}
  };
  const recover=async()=>{
    const command=current.current;if(!command||recovery.isPending)return;setChecked(false);
    try{const result=await recovery.mutateAsync(command);if(current.current!==command)return;if(confirmedReceipt(result,command.id)){await command.success(result);current.current=null;setStatus('idle');setError(null);}else{setChecked(true);setStatus('unknown');}}
    catch(reason){setError(reason);if(reason instanceof ApiError&&[401,403].includes(reason.status)){current.current=null;setStatus('rejected');}else setStatus('unknown');}
  };
  const reset=()=>{if(status==='conflict'){current.current=null;setStatus('idle');setError(null);}};
  return {run,recover,reset,status,error,checked,busy:status==='pending'||recovery.isPending,blocked:current.current!==null,id:current.current?.id};
}
type CommandController=ReturnType<typeof useCommandState>;
const CommandContext=createContext<CommandController|null>(null);
export function CommandProvider({children}:{children:ReactNode}){const controller=useCommandState();return createElement(CommandContext.Provider,{value:controller},children);}
export function useCommand():CommandController{const value=useContext(CommandContext);if(!value)throw new Error('Member command scope required');return value;}
