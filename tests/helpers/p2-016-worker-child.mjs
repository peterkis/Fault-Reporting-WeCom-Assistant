import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';
import { createCommunicationDeliveryWorker } from '../../src/p2-004-communication-delivery-worker.mjs';
const pool=createPostgresPool({connectionString:process.env.PILOT_DATABASE_URL,max:1,application_name:'p2_016_test_worker_child'});
process.once('message',async input=>{
  let calls=0;
  try{
    const worker=createCommunicationDeliveryWorker({pool,enabled:true,leaseMs:30000,sendTimeoutMs:30000,
      nowEpochMs:()=>String(Date.now()+(input.mode==='hang'?0:60000)),sender:{send:async()=>{
        calls++;
        if(input.mode==='hang'){process.send({kind:'provider-entered'});return new Promise(()=>{});}
        return {outcome:'ACKNOWLEDGED',provider_message_id:'synthetic-restart-ack',error_code:null,retryable:false};
      }}});
    if(input.mode==='recover')await worker.recoverExpiredSending();
    await worker.deliver({deliveryId:input.deliveryId});
    const row=await worker.getDelivery({deliveryId:input.deliveryId});
    process.send({kind:'done',calls,status:row.status});await pool.end();process.exit(0);
  }catch{process.send?.({kind:'error',code:'P2_016_WORKER_CHILD_FAILED'});await pool.end().catch(()=>{});process.exit(2);}
});
