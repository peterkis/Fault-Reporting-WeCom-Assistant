import type {PostgresQueryRow,PostgresTransaction} from './postgres-pool.mjs';

export interface CatalogSnapshot<R> {snapshot:R|null}

/** Run a trusted, zero-or-one-row catalog SELECT with the search path used by
 * the frozen inventories. Keep its original bindings and JSON field order. */
export async function readCatalogRow<R extends PostgresQueryRow>(connection:PostgresTransaction,sql:string,values:unknown[]){
  // Each materialized row feeds the next. The correlated subquery renders the
  // inventory after the path is pinned, and the outer filter restores the path
  // after rendering, including when the inventory has no row. Both changes are
  // transaction-local, so PostgreSQL also unwinds them on statement failure.
  const result=await connection.query<CatalogSnapshot<R>>(`
    WITH caller_path AS MATERIALIZED (
      SELECT pg_catalog.current_setting('search_path') AS original,pg_catalog.current_setting('quote_all_identifiers') AS original_quote
    ), pinned_path AS MATERIALIZED (
      SELECT original,original_quote,pg_catalog.set_config('search_path','pg_catalog, public, pg_temp',true) AS effective,
        pg_catalog.set_config('quote_all_identifiers','off',true) AS effective_quote
      FROM caller_path
    ), rendered AS MATERIALIZED (
      SELECT original,original_quote,(SELECT pg_catalog.row_to_json(inventory) FROM (${sql}) inventory
        WHERE pinned_path.effective IS NOT NULL AND pinned_path.effective_quote IS NOT NULL) AS snapshot
      FROM pinned_path
    )
    SELECT snapshot FROM rendered
    WHERE pg_catalog.set_config('search_path',rendered.original,true) IS NOT NULL
      AND pg_catalog.set_config('quote_all_identifiers',rendered.original_quote,true) IS NOT NULL`,values);
  return result.rows[0]?.snapshot??undefined;
}
