import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';
import { createP2012Runtime } from '../../src/p2-012-workbench-assembly.mjs';
const pool=createPostgresPool({connectionString:process.env.PILOT_DATABASE_URL,max:2,application_name:'p2_012_test_server_child'});
let runtime;
process.once('message',async input=>{
  try{
    runtime=createP2012Runtime({pool,principalId:input.principalId,publicOrigin:'http://127.0.0.1:'+input.port,listenPort:input.port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true},closePoolOnStop:true});
    if(input.crashAfterCommit)runtime.server.on('request',(request,response)=>{
      if(request.url?.endsWith('/confirm')){
        const end=response.end.bind(response);
        response.end=(...args)=>{
          if(response.statusCode===200){process.send({kind:'committed'});request.socket.destroy();process.kill(process.pid,'SIGKILL');return response;}
          return end(...args);
        };
      }
    });
    const started=await runtime.start();process.send({kind:'ready',cookie:started.cookie.name+'='+started.cookie.value});
  }catch{process.send?.({kind:'error',code:'P2_012_SERVER_CHILD_FAILED'});await pool.end().catch(()=>{});process.exit(2);}
});
process.once('SIGTERM',()=>{void runtime?.stop().finally(()=>process.exit(0));});
