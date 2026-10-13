import assert from 'node:assert/strict';
import {request} from 'node:http';
import {object,text,version} from './t07-public-fixture.mjs';

/** A sequential restarted host must not inherit a pooled socket from the stopped host. */
export async function t12FreshHttp(f:{origin:string;cookies:readonly string[]},index:number){
 const cookie=f.cookies[index];assert.ok(cookie);const origin=new URL(f.origin);assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');
 const send=async(path:string,method:'GET'|'POST',headers:Record<string,string>,body?:string)=>{
  let closed:Promise<void>|undefined;
  try{return await new Promise<{status:number;value:Record<string,unknown>}>((resolve,reject)=>{
   const req=request(new URL(path,origin),{method,headers:{cookie,...headers},agent:false},response=>{
    const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:unknown)=>{if(!Buffer.isBuffer(chunk)){req.destroy(Error('T12_HTTP_NON_BUFFER'));return;}size+=chunk.length;if(size>65536){req.destroy(Error('T12_HTTP_RESPONSE_LIMIT'));return;}chunks.push(chunk);});
    response.once('error',reject);response.once('end',()=>{try{resolve({status:response.statusCode??0,value:object(JSON.parse(Buffer.concat(chunks).toString('utf8')))});}catch(error){reject(error);}});
   });
   closed=new Promise(resolve=>req.once('close',resolve));req.setTimeout(10000,()=>req.destroy(Error('T12_HTTP_TIMEOUT')));req.once('error',reject);req.end(body);
  });}finally{await closed;}
 };
 const get=(path:string)=>send(path,'GET',{}),bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
 return {get,post:(path:string,body:Readonly<Record<string,unknown>>)=>send(path,'POST',{origin:f.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+version(body.expected_version)+'"'},JSON.stringify(body))};
}
