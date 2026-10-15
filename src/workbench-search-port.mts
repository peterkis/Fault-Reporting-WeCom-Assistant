import type {WorkbenchSearchRequest,WorkbenchSearchPage} from '../contracts/workbench_search_contracts.js';

/** Proposed default; no Runtime host consumes a T41 switch in this SOURCE_ONLY preparation. */
export const WORKBENCH_SEARCH_DEFAULT_ENABLED=false;
/**
 * Current READ and canonicalization must precede all matching and pagination.
 * This is a type seam only: no implementation, mounted route, mock success or fallback.
 */
export interface WorkbenchSearchPort {
 search(input:{readonly authContext:unknown;readonly request:WorkbenchSearchRequest}):Promise<WorkbenchSearchPage>;
}
