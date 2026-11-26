import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';

export interface RoleSettingSpec {
  readonly name: string;
  readonly value: string;
  readonly reason: string;
}

/**
 * Card 42A-7: application connection role database settings.
 * Card 42B will later append statement_timeout, lock_timeout, and idle_in_transaction_session_timeout here.
 */
export const ROLE_SETTINGS: readonly RoleSettingSpec[] = Object.freeze([
  {
    name: 'jit',
    value: 'off',
    reason: 'Short OLTP board/card queries: LLVM JIT compile overhead (135-250 ms measured in card 42 §1) exceeds query execution time.',
  },
]);

const ROLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/u;

export function validateRoleName(role: string): string {
  if (typeof role !== 'string' || !ROLE_NAME_PATTERN.test(role)) {
    throw new Error('DB_ROLE_NAME_INVALID');
  }
  return role;
}

function quoteIdent(ident: string): string {
  return '"' + ident.replaceAll('"', '""') + '"';
}

export function buildRoleSettingSql(role: string, mode: 'apply' | 'reset'): string[] {
  const validRole = validateRoleName(role);
  const quoted = quoteIdent(validRole);
  if (mode === 'reset') {
    return ROLE_SETTINGS.map(setting => `ALTER ROLE ${quoted} RESET ${setting.name}`);
  }
  return ROLE_SETTINGS.map(setting => `ALTER ROLE ${quoted} SET ${setting.name} = ${setting.value}`);
}

export interface RoleSettingRow {exists:boolean;setconfig:string[]|null;database_config:string[]|null}

async function readRoleSettings(tx:Pick<PostgresTransaction,'query'>,role:string) {
  const validRole = validateRoleName(role);
  const row = (await tx.query<RoleSettingRow>(
    `SELECT r.oid IS NOT NULL AS exists,
            s.setconfig, d.setconfig AS database_config
       FROM (SELECT 1) one
       LEFT JOIN pg_roles r ON r.rolname = $1
       LEFT JOIN pg_db_role_setting s ON s.setrole = r.oid AND s.setdatabase = 0
       LEFT JOIN pg_db_role_setting d ON d.setrole = r.oid
         AND d.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())`,
    [validRole],
  )).rows[0];
  if (!row || !row.exists) {
    throw new Error('DB_ROLE_NOT_FOUND');
  }
  function evaluate(entries:readonly string[]) {
    const configMap=new Map<string,string>();
    for(const entry of entries){
      const eq=entry.indexOf('=');
      if(eq>0)configMap.set(entry.slice(0,eq),entry.slice(eq+1));
    }
    const current:Record<string,string|null>={};
    const missing:string[]=[];
    for(const setting of ROLE_SETTINGS){
      current[setting.name]=configMap.get(setting.name)??null;
      const actual=current[setting.name];
      // PostgreSQL accepts unambiguous, case-insensitive prefixes for Boolean settings.
      const matches=setting.name==='jit'&&setting.value==='off'
        ?typeof actual==='string'&&['0','of','off','n','no','f','fa','fal','fals','false'].includes(actual.toLowerCase())
        :actual===setting.value;
      if(!matches)missing.push(setting.name);
    }
    return {ok:missing.length===0,role:validRole,missing,current};
  }
  const wide=row.setconfig??[];
  return {wide:evaluate(wide),effective:evaluate([...wide,...row.database_config??[]])};
}

export async function checkRoleSettings(tx:Pick<PostgresTransaction,'query'>,role:string) {
  return (await readRoleSettings(tx,role)).effective;
}

export async function applyRoleSettings({
  databaseUrl,
  role,
  mode = 'check',
}: {
  databaseUrl: string;
  role: string;
  mode?: 'check' | 'apply' | 'reset';
}) {
  if (!databaseUrl) throw new Error('DB_ROLE_SETTINGS_DATABASE_URL_REQUIRED');
  if (!['check', 'apply', 'reset'].includes(mode)) throw new Error('DB_ROLE_SETTINGS_MODE_INVALID');
  const validRole = validateRoleName(role);
  const pool = createPostgresPool({connectionString: databaseUrl, max: 1, application_name: 'db_role_settings'});
  try {
    const before = await readRoleSettings(pool, validRole);
    if (mode === 'check') {
      return {status: before.effective.ok ? 'READY' : 'PENDING', ...before.effective};
    }
    if (mode === 'apply') {
      if(before.wide.ok) {
        return {status:before.effective.ok?'NOOP_ALREADY_APPLIED':'PENDING',...before.effective};
      }
      for (const statement of buildRoleSettingSql(validRole, 'apply')) {
        await pool.query(statement);
      }
      const after=await readRoleSettings(pool,validRole);
      const missing=[...new Set([...after.wide.missing,...after.effective.missing])];
      return {status:missing.length?'PENDING':'APPLIED',...after.effective,ok:missing.length===0,missing};
    }
    for (const statement of buildRoleSettingSql(validRole, 'reset')) {
      await pool.query(statement);
    }
    const after = await checkRoleSettings(pool, validRole);
    return {status: 'RESET', ...after};
  } finally {
    await pool.end();
  }
}

export function parseRoleSettingsArgs(argv: readonly string[]): {role: string; mode: 'check' | 'apply' | 'reset'} {
  let role: string | null = null;
  let mode: 'check' | 'apply' | 'reset' = 'check';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--role') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('DB_ROLE_SETTINGS_ROLE_REQUIRED');
      role = validateRoleName(next);
      i++;
    } else if (arg?.startsWith('--role=')) {
      role = validateRoleName(arg.slice(7));
    } else if (arg === '--check') {
      mode = 'check';
    } else if (arg === '--apply') {
      mode = 'apply';
    } else if (arg === '--reset') {
      mode = 'reset';
    } else {
      throw new Error('DB_ROLE_SETTINGS_ARGUMENT_INVALID');
    }
  }
  if (!role) throw new Error('DB_ROLE_SETTINGS_ROLE_REQUIRED');
  return {role, mode};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {role, mode} = parseRoleSettingsArgs(process.argv.slice(2));
    const databaseUrl = process.env.PILOT_DATABASE_URL;
    if (!databaseUrl) throw new Error('DB_ROLE_SETTINGS_DATABASE_URL_REQUIRED');
    const result=await applyRoleSettings({databaseUrl,role,mode});
    console.log(JSON.stringify(result));
    if(mode==='apply'&&!result.ok)process.exitCode=1;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error_code: 'DB_ROLE_SETTINGS_FAILED',
      detail: error instanceof Error ? error.message.slice(0, 200) : null,
    }));
    process.exitCode = 1;
  }
}
