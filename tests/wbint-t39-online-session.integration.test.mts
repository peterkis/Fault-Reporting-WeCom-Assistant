import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

interface Fixture {origin:string;backendOrigin:string;cookies:string[];sessionId:string;pool:PostgresPool}

// Card 31 (Codex review): the online roster requires a current Cookie session; the resolver re-checks it after the roster query.
test('Card 31 online roster answers a live Cookie session and refuses a revoked one',{timeout:120000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const cookie=f.cookies[0];assert.ok(cookie&&f.sessionId);
 const live=await fetch(f.backendOrigin+'/api/workbench/online',{headers:{cookie}});assert.equal(live.status,200,await live.clone().text());
 const body=await live.json() as {schema_version:number;people:unknown[];total:number};assert.equal(body.schema_version,1);assert.ok(Array.isArray(body.people));
 await f.pool.query("UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=platform.physical_epoch_ms(),revoked_at=platform.local_now() WHERE session_id=$1::uuid AND state='ACTIVE'",[f.sessionId]);
 const revoked=await fetch(f.backendOrigin+'/api/workbench/online',{headers:{cookie}});
 assert.ok([401,403].includes(revoked.status),'revoked session status '+revoked.status);assert.equal((await revoked.text()).includes('people'),false);
},{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,realWorkbenchAuthentication:true}));
