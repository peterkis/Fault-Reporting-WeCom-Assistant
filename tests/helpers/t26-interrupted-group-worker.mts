import {createPostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {createCommunicationDeliveryWorker} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createWorkbenchGroupNotificationSender} from '../../app/server/src/workbench-group-notification-sender.mjs';
const connectionString=process.env.T26_CASE_DB,deliveryId=process.env.T26_CASE_DELIVERY,groupId=process.env.T26_CASE_GROUP;
if(!connectionString||!deliveryId||!groupId)throw Error('T26_OWNED_CHILD_INPUT_REQUIRED');
const pool=createPostgresPool({connectionString,max:1,application_name:'t26-interrupted-group-worker'});
try{
 const sender=createWorkbenchGroupNotificationSender({pool,enabled:true,routes:[{botId:'bot-test',groupId,url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=t26-synthetic'}],resolveMentionUserId:async()=> 't26-verified-webhook-user',fetchImpl:async()=>{process.send?.('T26_FETCH_ENTERED');return new Promise<Response>(()=>{});}});
 await createCommunicationDeliveryWorker({pool,enabled:true,sender}).deliver({deliveryId});
}finally{await pool.end();}
