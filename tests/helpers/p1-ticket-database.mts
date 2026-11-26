import {test} from 'node:test';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {withP2015IsolatedDatabase} from './p2-015-postgres-harness.mjs';

type WithPool=(pool:PostgresPool)=>Promise<void>;

/** The supplied URL is used only by the database harness. Migrations and test actions receive the owned pool. */
export function isolatedTicketTests(purpose:string,prepare:WithPool){
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  return (name:string,run:WithPool)=>test(name,{skip:!databaseUrl},()=>withP2015IsolatedDatabase({
    databaseUrl,purpose,namespace:'ticket_card42a',run:async({pool}:{pool:PostgresPool})=>{
      await prepare(pool);
      await run(pool);
    },
  }));
}
