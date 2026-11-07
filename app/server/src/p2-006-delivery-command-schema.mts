import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {SERVICE_CLOSURE_MIGRATION_ID,serviceClosureSchemaReady} from '../scripts/service-closure-migrate.mjs';
import {p2016CatalogInventory} from '../scripts/p2-016-migrate.mjs';

export const CONVERSATION_DELIVERY_MIGRATION_ID='061_workbench_conversation_delivery_commands';
const RECEIPT_SHAPES={
 BASE:{before:'a8649673ed1d3553ecae4e947a4431a5994651b44866379604cd8ea867827fa6',after:'f0bf5a52ea48858760adee673c9b0fa3c124699120870e1f2cbc64e778f3a1c5'},
 MANUAL:{before:'1922b89e51e17711c74c3c9d6e0f621dfdaffbd7dd869f7a19a9f6efcb793e28',after:'fa240cb0dcfbb80783d21b3cc559315856cdc6240a664d06196dad0c6c89f6c4'},
 INTAKE:{before:'a7184f19a7bae6b9fcd94aa2099dd63187a25f3f988c6d79c91f0e2c4187c9b3',after:'73b014af686af085ac99621078a1d704c0a495aa2e1a6f4597ef72272ec28b06'},
 BOT:{before:'383852a01474f598915d2e58548f6d95f5b64bd7810052ba5f6047e2e079ecff',after:'6c1dc1e426c49b25ff61f1a8add21c9085fcd7ae580dd9291fedd6b9f403739b'},
} as const;
// PG18 schema-only observations for 071 across BASE/MANUAL/INTAKE/BOT, before and after 061.
const CLOSURE_RESOURCE_PREDECESSORS:Readonly<Record<string,string>>={
  "b7304a51cb24da565a8e45535e3a7400215563f6a245678c0d684c7043742a0c": "e3c05c64f808771fdcfa189e677dac84ee999cf0e7cb7f90a8e3d3c830aefcec",
  "5a6fa9852cff6f48c61000945cfc9e3ae513bce47e73a6a4e06371f600ed5693": "4713f66ab1a26e897c0a36a8ef76da5b70a575ac0c0c38ce312a126c0d48bd06",
  "c2138a2aa78f42c11d10b9204153138788e6ec4c5a4578efefc9b44eb689a37b": "1ccca7d6b99aec5d5b599a7ec4238cf569da5335d1046b495f4176f2eb0e1428",
  "cf1c824d2706d98b1c0d8ed4f11c2c958ab9cdb689b0f0b91d2da2fab32e4667": "b9baebb69f7352970668689269c27e0a7292bd670565d54a5eceeac17198fdfc",
  "da6cb00c152ac8d350cb72e96e2d9ea5744ab15aa23fddeaf83470c3c7b66921": "0c23ded345dc9baa03c4eb471ab9cc60f29ea8909af502042ed8fea068dd63c2",
  "7a25bfe505844136817b1634571612b2958d24f5a46d3d7461e2ee2040852a8b": "26ab85813480eaa198d3f900da0ff009d726e0ae3e74bf4173155388691e0fb0"
};
const PARENTS=['031_p2_016_ticket_lifecycle_workbench_notifications','042_workbench_manual_reports','047_workbench_personal_read','050_bot_reporter_feedback'] as const;
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function sha(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
export async function conversationDeliveryReceiptCatalog(tx:PostgresTransaction):Promise<Record<string,unknown>>{
 const complete:unknown=await p2016CatalogInventory(tx);if(!record(complete))throw Error('CONVERSATION_DELIVERY_CATALOG_INVALID');
 const receipt:Record<string,unknown>={};
 for(const category of ['relations','columns','constraints','indexes','triggers']){
  const rows=complete[category];if(!Array.isArray(rows)||!rows.every(record))throw Error('CONVERSATION_DELIVERY_CATALOG_INVALID');
  receipt[category]=rows.filter(row=>row.relation==='pilot_ticket.ticket_command_receipt');
 }
 return receipt;
}
/** Project only the verified 071 extension out of the existing exact receipt inventory.
 * Unknown columns, guards, FKs, indexes and triggers still participate in the old digest. */
export async function normalizeServiceClosureReceiptCatalog(tx:PostgresTransaction,catalog:Record<string,unknown>):Promise<Record<string,unknown>>{
 const marker=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[SERVICE_CLOSURE_MIGRATION_ID])).rows[0];
 if(!marker)return catalog;
 if(!await serviceClosureSchemaReady(tx))throw Error('SERVICE_CLOSURE_SCHEMA_DRIFT');
 const columns=catalog.columns,constraints=catalog.constraints;
 if(!Array.isArray(columns)||!columns.every(record)||!Array.isArray(constraints)||!constraints.every(record))throw Error('SERVICE_CLOSURE_SCHEMA_DRIFT');
 const own=columns.filter(r=>r.name==='closure_intake_id'),fk=constraints.filter(r=>r.name==='ticket_command_receipt_closure_intake_id_fkey'),resource=constraints.filter(r=>r.name==='p2016_command_resource');
 const c=own[0],f=fk[0],guard=resource[0];
 if(own.length!==1||!c||c.type!=='uuid'||c.not_null!==false||c.identity!==''||c.generated!==''||c.default_expression!==null
  ||fk.length!==1||!f||f.type!=='f'||f.validated!==true||f.deferrable!==false||f.deferred!==false
  ||f.definition!=='FOREIGN KEY (closure_intake_id) REFERENCES intake.service_intake(id) ON DELETE RESTRICT'
  ||resource.length!==1||!guard||guard.type!=='c'||guard.validated!==true||typeof guard.definition!=='string')throw Error('SERVICE_CLOSURE_SCHEMA_DRIFT');
 const expected=CLOSURE_RESOURCE_PREDECESSORS[sha(guard.definition)];
 const baseline=(await tx.query<{command_resource_check:string}>('SELECT command_resource_check FROM pilot_ticket.closure_migration_baseline WHERE singleton')).rows[0];
 if(!expected||!baseline||sha(baseline.command_resource_check)!==expected)throw Error('SERVICE_CLOSURE_SCHEMA_DRIFT');
 return {...catalog,columns:columns.filter(r=>r!==c),constraints:constraints.filter(r=>r!==f).map(r=>r===guard?{...r,definition:baseline.command_resource_check}:r)};
}
/** Complete inventories observed on actual PostgreSQL 18, with unchanged old SQL checksums. */
export async function conversationDeliveryReceiptSchemaShape(tx:PostgresTransaction,phase:'before'|'after'='after'):Promise<keyof typeof RECEIPT_SHAPES|null>{
 const table=(await tx.query<{present:boolean}>("SELECT to_regclass('platform.schema_migration') IS NOT NULL AS present")).rows[0];if(!table?.present)return null;
 const markers=(await tx.query<{migration_id:string;checksum_sha256:string}>('SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[]) ORDER BY migration_id',[[...PARENTS,CONVERSATION_DELIVERY_MIGRATION_ID]])).rows;
 const ids=new Set(markers.map(row=>row.migration_id));if(!ids.has(PARENTS[0])||ids.has(PARENTS[2])&&!ids.has(PARENTS[1])||ids.has(PARENTS[3])&&!ids.has(PARENTS[2]))return null;
 if(ids.has(CONVERSATION_DELIVERY_MIGRATION_ID)!==(phase==='after'))return null;
 for(const marker of markers)if(marker.checksum_sha256!==sha(await readFile(new URL('../../../database/migrations/'+marker.migration_id+'.sql',import.meta.url))))return null;
 const shape: keyof typeof RECEIPT_SHAPES=ids.has(PARENTS[3])?'BOT':ids.has(PARENTS[2])?'INTAKE':ids.has(PARENTS[1])?'MANUAL':'BASE';
 return sha(JSON.stringify(await normalizeServiceClosureReceiptCatalog(tx,await conversationDeliveryReceiptCatalog(tx))))===RECEIPT_SHAPES[shape][phase]?shape:null;
}
export async function conversationDeliveryReceiptSchemaReady(tx:PostgresTransaction):Promise<boolean>{return await conversationDeliveryReceiptSchemaShape(tx)!==null;}
/** Only the exact complete original 031/032 inventories plus 061 are accepted. */
export async function conversationDeliveryBaseCatalogReady(tx:PostgresTransaction,inventory:unknown,kind:'031'|'032'):Promise<boolean>{
 const expected=kind==='031'?'3e4fba12dec754ac16b2ea551e610020a69b4d45823cf99f66481cea66cabf87':'39afb4e28e84e2d2e26531a13c312117fc721dcf9ac029a82436c64c1764de83';
 return sha(JSON.stringify(inventory))===expected&&await conversationDeliveryReceiptSchemaShape(tx)==='BASE';
}
