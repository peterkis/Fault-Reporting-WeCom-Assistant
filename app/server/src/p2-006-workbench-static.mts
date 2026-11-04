import type {ServerResponse} from 'node:http';

/** Bare G1 exposes API/SSE only; the retired reference UI has no assets. */
export function createWorkbenchStaticHandler({enabled=false}:{enabled?:boolean}={}){
  if(typeof enabled!=='boolean')throw new TypeError('Static handler configuration is invalid.');
  return async(_pathname:string,_response:ServerResponse)=>false;
}
