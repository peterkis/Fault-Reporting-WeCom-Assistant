import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
interface Fixture {origin:string;cookies:string[];principals:{id:string}[];pool:PostgresPool}
function obj(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
const input=()=>({schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'T19 合成现场：打印机无法打印',location:{text:'合成值班室',unknown:false},reporter:{verification:'UNVERIFIED',name:'实际报修人T19',contact:'合成内线1919',department:'合成科室'},resolver_team_id:'PILOT_IT'});
async function client({origin,cookies}:Fixture,index=0){
  const cookie=cookies[index];assert.ok(cookie);const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(bootstrap.status,200);const csrf=obj(await bootstrap.json()).csrf_token;assert.equal(typeof csrf,'string');
  return {get:(path:string)=>fetch(origin+path,{headers:{cookie}}),post:(body:unknown,path='/api/workbench/reports/take-and-start')=>fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':String(obj(body).client_command_id),'x-csrf-token':csrf as string},body:JSON.stringify(body)})};
}
test('T19 legal non-default groups require actual current membership even for an administrator, and replay cannot change a group or cross the ordinary admission action',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const c=await client(f),actor=f.principals[0];assert.ok(actor);
    await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name,is_active) VALUES('T19_NETWORK','合成网络组',true)");
    const noMembership={...input(),resolver_team_id:'T19_NETWORK'};assert.equal((await c.post(noMembership)).status,403);
    await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,'T19_NETWORK')",[actor.id]);
    const context=await c.get('/api/workbench/reports/self-handling-context');assert.equal(context.status,200);assert.deepEqual(obj(await context.json()).resolver_teams,[{id:'PILOT_IT',name:'Pilot 信息保障组'},{id:'T19_NETWORK',name:'合成网络组'}]);
    const command={...input(),resolver_team_id:'T19_NETWORK'},response=await c.post(command);assert.equal(response.status,202,await response.clone().text());const result=obj(await response.json()),ticket=obj(result.ticket);assert.equal(ticket.status,'IN_PROGRESS');
    const detail=await c.get('/api/tickets/'+ticket.id);assert.equal(detail.status,200);assert.equal(obj(await detail.json()).resolver_team_id,'T19_NETWORK');
    assert.equal((await c.post({...command,resolver_team_id:'PILOT_IT'})).status,409);
    const {resolver_team_id,...ordinary}=command;assert.equal((await c.post(ordinary,'/api/workbench/reports')).status,409);
    const replay=await c.post(command);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{...result,replayed:true});
    await f.pool.query("DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id='T19_NETWORK'",[actor.id]);assert.equal((await c.post(command)).status,403);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,manualProjection:true});
});
test('T19 a start failure rolls back the whole admission and responsibility while an explicit ordinary report may still enter Review',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const c=await client(f),actor=f.principals[0];assert.ok(actor);const command=input();
    await f.pool.query("CREATE FUNCTION pilot_ticket.t19_reject_start() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='ticket.started' THEN RAISE EXCEPTION 'synthetic start failure'; END IF; RETURN NEW; END$$");
    await f.pool.query('CREATE TRIGGER t19_reject_start BEFORE INSERT ON pilot_ticket.ticket_event FOR EACH ROW EXECUTE FUNCTION pilot_ticket.t19_reject_start()');
    const result=await c.post(command);assert.equal(result.status,503);assert.equal(obj(await result.json()).ok,false);
    const row=(await f.pool.query<{state:string;intakes:number}>(`SELECT r.state,count(i.id)::integer AS intakes FROM pilot_ticket.ticket_command_receipt r LEFT JOIN intake.service_intake i ON i.manual_command_receipt_id=r.id WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid GROUP BY r.state`,['P2_016:'+actor.id,command.client_command_id])).rows[0];assert.deepEqual(row,{state:'FAILED',intakes:0});
    await f.pool.query('DROP TRIGGER t19_reject_start ON pilot_ticket.ticket_event');await f.pool.query('DROP FUNCTION pilot_ticket.t19_reject_start()');
    assert.equal((await c.post(command)).status,503,'a saved failed original command is not executed again');
    const unclear={...input(),description:'T19 合成材料尚不能说明发生了什么，请协助判断'};const denied=await c.post(unclear);assert.equal(denied.status,503);assert.equal(obj(await denied.json()).ok,false);
    const {resolver_team_id,...ordinary}=unclear;const admitted=await c.post({...ordinary,client_command_id:randomUUID()},'/api/workbench/reports');assert.equal(admitted.status,202);const manual=obj(await admitted.json());assert.equal(manual.ticket,null);assert.ok(manual.review);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,manualProjection:true});
});
test('T19 concurrent original POSTs return one admission, and unknown receipt lookup never writes or changes an ordinary report',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const c=await client(f),command=input(),actor=f.principals[0];assert.ok(actor);
    const responses=await Promise.all([c.post(command),c.post(command)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,202]);const results=await Promise.all(responses.map(async r=>obj(await r.json())));assert.equal(obj(results[0]?.ticket).id,obj(results[1]?.ticket).id);
    const count=(await f.pool.query<{intakes:number;tickets:number;cycles:number}>(`SELECT count(DISTINCT i.id)::integer AS intakes,count(DISTINCT t.id)::integer AS tickets,count(DISTINCT cy.id)::integer AS cycles FROM intake.service_intake i JOIN pilot_ticket.ticket_command_receipt r ON r.id=i.manual_command_receipt_id LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id LEFT JOIN pilot_ticket.ticket_handling_cycle cy ON cy.ticket_id=t.id WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid`,['P2_016:'+actor.id,command.client_command_id])).rows[0];assert.deepEqual(count,{intakes:1,tickets:1,cycles:1});
    const id=randomUUID(),unknown=await c.get('/api/workbench/reports/commands/'+id);assert.equal(unknown.status,200);assert.deepEqual(await unknown.json(),{client_command_id:id,state:'UNKNOWN'});assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[id])).rowCount,0);
    const {resolver_team_id,...ordinary}=input(),old=await c.post(ordinary,'/api/workbench/reports');assert.equal(old.status,202);assert.equal(obj(obj(await old.json()).ticket).status,'QUEUED');
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:true,manualProjection:true});
});
