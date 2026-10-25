import {acceptedReceipt} from '../lib/command';
type Purpose='URGE'|'EVALUATION'|'FEEDBACK'|'SUPPLEMENT';
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}

/** Correlate recovery with the UUID, request and purpose frozen before the POST. */
export function detailReceipt(id:string,requestRef:string,purpose:Purpose,completedRoundRef?:string){
 return (value:unknown,phase:'execute'|'recover'):boolean=>{
  if(!object(value))return false;
  let result:Record<string,unknown>=value;
  if(phase==='recover'){
   if(value.state!=='COMMITTED'||value.client_command_id!==id||!object(value.result))return false;
   if('request_ref'in value&&value.request_ref!==requestRef)return false;
   if((purpose==='URGE'||purpose==='EVALUATION')&&value.purpose!==purpose)return false;
   result=value.result;
  }
  if(purpose==='SUPPLEMENT'){
   const receipt=object(result.receipt)?result.receipt:result;
   return acceptedReceipt(result,id)&&receipt.request_ref===requestRef;
  }
  if(result.ok!==true||result.request_ref!==requestRef)return false;
  if(purpose==='FEEDBACK')return typeof completedRoundRef==='string'&&result.completed_round_ref===completedRoundRef;
  return result.client_command_id===id&&result.purpose===purpose;
 };
}
