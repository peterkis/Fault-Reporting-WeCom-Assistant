function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function acceptedReceipt(value:unknown,id:string):boolean {
 if(!object(value))return false;
 if(object(value.receipt))return acceptedReceipt(value.receipt,id);
 return value.client_command_id===id&&value.status==='ACCEPTED'&&typeof value.request_ref==='string'&&/^[A-Za-z0-9_-]{32}$/.test(value.request_ref);
}
export function confirmedReceipt(value:unknown,id:string):boolean {
 if(acceptedReceipt(value,id))return true;
 if(!object(value)||value.state!=='COMMITTED'||value.client_command_id!==id||!object(value.result))return false;
 if('client_command_id'in value.result&&value.result.client_command_id!==id)return false;
 return value.result.ok===true||acceptedReceipt(value.result,id);
}

