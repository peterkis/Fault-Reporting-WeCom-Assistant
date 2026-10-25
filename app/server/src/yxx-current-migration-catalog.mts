import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {PostgresPool} from './platform/postgres-pool.mjs';
import {CURRENT_YXX_BASE,CURRENT_YXX_TREE,CURRENT_YXX_CONTRACT} from './yxx-current-readiness-scope.mjs';

const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');

/** Explicit offline replay profile; never substitutes for a historical default. */
export async function assertCurrentMigrationCatalog(tx:Pick<PostgresPool,'query'>,kind:'yxx'|'p2012',inventory:unknown):Promise<void>{
  try{
    assert.ok(['yxx','p2012'].includes(kind));
    const bytes=readFileSync(new URL('../../../contracts/yxx_current_migration_catalog.v2.json',import.meta.url));assert.ok(bytes.length<=16*1024*1024);
    const contract:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));assert.ok(record(contract));
    assert.equal(contract.schema_version,1);assert.equal(contract.contract,CURRENT_YXX_CONTRACT);
    assert.equal(contract.base_head,CURRENT_YXX_BASE);assert.equal(contract.base_tree,CURRENT_YXX_TREE);
    assert.equal(contract.live_authorized,false);assert.equal(contract.sql_changes_authorized,false);
    assert.ok(record(contract.catalogs));assert.deepEqual(Object.keys(contract.catalogs).sort(),['p2012','yxx']);
    assert.ok(record(contract.catalogs[kind]));assert.ok(isDeepStrictEqual(inventory,contract.catalogs[kind]),'current catalog differs');
    assert.ok(Array.isArray(contract.migration_files));
    const files=contract.migration_files.map((value:unknown)=>{
      assert.ok(record(value));assert.deepEqual(Object.keys(value).sort(),['path','sha256_utf8_lf']);
      assert.ok(typeof value.path==='string'&&/^database\/migrations\/[0-9]{3}_[a-z0-9_]+\.sql$/u.test(value.path));
      assert.ok(typeof value.sha256_utf8_lf==='string'&&/^[a-f0-9]{64}$/u.test(value.sha256_utf8_lf));
      const sql=readFileSync(new URL('../../../'+value.path,import.meta.url));
      assert.equal(digest(new TextDecoder('utf-8',{fatal:true}).decode(sql).replaceAll('\r\n','\n')),value.sha256_utf8_lf);
      return {path:value.path,checksum_sha256:digest(sql)};
    });
    assert.equal(files.length,49);assert.deepEqual(files.map(file=>file.path),[...new Set(files.map(file=>file.path))].sort());
    const expected=files.slice(14).map(file=>({migration_id:path.posix.basename(file.path,'.sql'),checksum_sha256:file.checksum_sha256,time_pair:true}));
    const markers=await tx.query<{migration_id:string;checksum_sha256:string;time_pair:boolean}>(
      'SELECT migration_id,checksum_sha256,applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair FROM platform.schema_migration ORDER BY migration_id');
    assert.deepEqual(markers.rows,expected,'current replay requires the complete applied combination');
  }catch{
    throw Object.assign(new Error('CURRENT_MIGRATION_CATALOG_INVALID'),{code:'CURRENT_MIGRATION_CATALOG_INVALID'});
  }
}
