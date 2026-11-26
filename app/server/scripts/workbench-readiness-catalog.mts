import type { PostgresTransaction } from '../src/platform/postgres-pool.mjs';
import {FK_INDEX_TARGETS, type WorkbenchIndexRow} from './fk-indexes-migrate.mjs';

type CatalogRow = Record<string, unknown>;
type Catalog = {
  relations: CatalogRow[];
  columns: CatalogRow[];
  constraints: CatalogRow[];
  indexes: CatalogRow[];
  triggers: CatalogRow[];
};

type Inventory = Omit<Catalog, 'indexes'> & {indexes: WorkbenchIndexRow[]; closure_present: boolean};

export const RECEIPT_RELATION = 'pilot_ticket.ticket_command_receipt';

// JSON.parse produces ordinary objects, arrays, and scalars. Keep the validated
// objects themselves so their SELECT-list key order survives digest projection.
function object(value: unknown): value is CatalogRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function relationRow(row: unknown): row is CatalogRow {
  return object(row) && typeof row.relation === 'string' && typeof row.relkind === 'string'
    && typeof row.relpersistence === 'string' && typeof row.relispartition === 'boolean'
    && typeof row.relrowsecurity === 'boolean' && typeof row.relforcerowsecurity === 'boolean';
}
function namedRow(row: unknown): row is CatalogRow {
  return object(row) && typeof row.relation === 'string' && typeof row.name === 'string';
}
function columnRow(row: unknown): row is CatalogRow {
  return namedRow(row) && Number.isInteger(row.ordinal) && typeof row.type === 'string'
    && typeof row.not_null === 'boolean' && typeof row.identity === 'string' && typeof row.generated === 'string'
    && (row.default_expression === null || typeof row.default_expression === 'string');
}
function constraintRow(row: unknown): row is CatalogRow {
  return namedRow(row) && typeof row.type === 'string' && typeof row.validated === 'boolean'
    && typeof row.deferrable === 'boolean' && typeof row.deferred === 'boolean' && typeof row.definition === 'string';
}
function indexRow(row: unknown): row is WorkbenchIndexRow {
  if (!namedRow(row) || typeof row.valid !== 'boolean' || typeof row.ready !== 'boolean'
    || typeof row.unique !== 'boolean' || typeof row.primary !== 'boolean' || typeof row.definition !== 'string') return false;
  const fk = row.fk;
  return fk === null || (object(fk) && typeof fk.eligible === 'boolean' && Number.isInteger(fk.key_count)
    && Array.isArray(fk.columns) && fk.columns.every(column => typeof column === 'string'));
}

function parseRows<T>(text: unknown, valid: (row: unknown) => row is T): T[] {
  if (typeof text !== 'string') throw Error('CONVERSATION_DELIVERY_CATALOG_INVALID');
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    throw Error('CONVERSATION_DELIVERY_CATALOG_INVALID');
  }
  if (!Array.isArray(rows) || !rows.every(valid)) throw Error('CONVERSATION_DELIVERY_CATALOG_INVALID');
  return rows;
}

/** Both digests are projections of the same ordered catalog rows. */
export function projectWorkbenchCatalog(catalog: Inventory, targets: readonly string[], shape: 'receipt' | 'supplement'): Catalog {
  const selected = (rows: CatalogRow[]) => rows.filter(row => targets.some(target => target === row.relation));
  const relations = selected(catalog.relations);
  const indexes = catalog.indexes.filter(row => targets.includes(row.relation)).map(({fk, ...index}) => index);
  return {
    relations: shape === 'receipt' ? relations.map(({relispartition, ...row}) => row) : relations,
    columns: selected(catalog.columns),
    constraints: selected(catalog.constraints),
    indexes: shape === 'receipt' ? indexes.map(({unique, primary, ...row}) => row) : indexes,
    triggers: selected(catalog.triggers),
  };
}
export async function workbenchReadinessCatalog(
  tx: PostgresTransaction,
  targets: readonly string[],
  shape: 'receipt' | 'supplement',
): Promise<Catalog> {
  return projectWorkbenchCatalog(await readWorkbenchCatalog(tx, targets, false), targets, shape);
}

export async function readWorkbenchCatalog(tx: PostgresTransaction, targets: readonly string[], checkClosure: boolean, checkFk = false): Promise<Inventory> {
  const fkNames = checkFk ? FK_INDEX_TARGETS.filter(t => targets.includes(t.schema+'.'+t.table)).map(t => t.name) : [];
  // A quoted schema or relation can contain dots. Every possible relation
  // suffix is a candidate for the name index. The concatenation decides membership.
  const suffixes = new Set<string>();
  for (const target of targets) {
    for (let dot = target.indexOf('.'); dot >= 0; dot = target.indexOf('.', dot + 1)) {
      suffixes.add(target.slice(dot + 1));
    }
  }

  // Standalone digest readers do not require access to the 076 proof catalogs.
  const fkFacts = fkNames.length === 0 ? 'NULL::json' : `CASE WHEN c.relname=ANY($4::name[]) THEN json_build_object(
               'eligible', c.relnamespace=r.relnamespace AND c.relkind='i' AND c.relpersistence='p'
                 AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree')
                 AND i.indislive AND i.indimmediate AND NOT i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
                 AND i.indnatts=i.indnkeyatts,
               'key_count', i.indnkeyatts,
               'columns', ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(num,pos)
                                JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.pos)
             ) END`;

  // json (not jsonb) preserves SELECT-list key order in the hashed rows.
  const row = (await tx.query(`
    WITH targets AS MATERIALIZED (
      SELECT c.oid, c.relnamespace, n.nspname||'.'||c.relname AS relation,
             c.relkind, c.relpersistence,
             c.relispartition, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = ANY($2::name[]) AND n.nspname||'.'||c.relname = ANY($1::text[])
    ), relations AS (
      SELECT relation, relkind, relpersistence, relispartition,
             relrowsecurity, relforcerowsecurity
        FROM targets
    ), columns AS (
      SELECT r.relation, a.attname AS name, a.attnum AS ordinal,
             format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
             a.attidentity AS identity, a.attgenerated AS generated,
             pg_get_expr(d.adbin,d.adrelid) AS default_expression
        FROM targets r JOIN pg_attribute a ON a.attrelid = r.oid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attnum > 0 AND NOT a.attisdropped
    ), constraints AS (
      SELECT r.relation, c.conname AS name, c.contype AS type, c.convalidated AS validated,
             c.condeferrable AS deferrable, c.condeferred AS deferred,
             pg_get_constraintdef(c.oid,true) AS definition
        FROM targets r JOIN pg_constraint c ON c.conrelid = r.oid
    ), indexes AS (
      SELECT r.relation, c.relname AS name, i.indisvalid AS valid, i.indisready AS ready,
             i.indisunique AS unique, i.indisprimary AS primary,
             pg_get_indexdef(c.oid) AS definition,
             ${fkFacts} AS fk
        FROM targets r JOIN pg_index i ON i.indrelid = r.oid JOIN pg_class c ON c.oid = i.indexrelid
    ), triggers AS (
      SELECT r.relation, t.tgname AS name
        FROM targets r JOIN pg_trigger t ON t.tgrelid = r.oid WHERE NOT t.tgisinternal
    )
    SELECT
      CASE WHEN $3::boolean THEN to_regclass('pilot_ticket.closure_record') IS NOT NULL
        AND to_regclass('pilot_ticket.closure_supplement_termination') IS NOT NULL ELSE false END AS closure_present,
      (SELECT COALESCE(json_agg(r ORDER BY r.relation), '[]')::text FROM relations r) AS relations,
      (SELECT COALESCE(json_agg(c ORDER BY c.relation, c.ordinal), '[]')::text FROM columns c) AS columns,
      (SELECT COALESCE(json_agg(c ORDER BY c.relation, c.name), '[]')::text FROM constraints c) AS constraints,
      (SELECT COALESCE(json_agg(i ORDER BY i.relation, i.name), '[]')::text FROM indexes i) AS indexes,
      (SELECT COALESCE(json_agg(t ORDER BY t.relation, t.name), '[]')::text FROM triggers t) AS triggers
  `, fkNames.length > 0 ? [targets, [...suffixes], checkClosure, fkNames] : [targets, [...suffixes], checkClosure])).rows[0];
  if (typeof row?.closure_present !== 'boolean') throw Error('CONVERSATION_DELIVERY_CATALOG_INVALID');
  return {
    relations: parseRows(row.relations, relationRow),
    columns: parseRows(row.columns, columnRow),
    constraints: parseRows(row.constraints, constraintRow),
    indexes: parseRows(row.indexes, indexRow),
    triggers: parseRows(row.triggers, namedRow),
    closure_present: row.closure_present,
  };
}
