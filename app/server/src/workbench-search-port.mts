import type {WorkbenchSearchRequest,WorkbenchSearchPage} from '../../../contracts/workbench_search_contracts.js';

/** Default-false search switch; current Source wiring is NOT_BUILT_NOT_RUN. */
export const WORKBENCH_SEARCH_DEFAULT_ENABLED=false;
/**
 * Current READ and canonicalization must precede all matching and pagination.
 * The implementation reuses original facts; no mock success or source fallback.
 */
export interface WorkbenchSearchPort {
 search(input:{readonly authContext:unknown;readonly request:WorkbenchSearchRequest}):Promise<WorkbenchSearchPage>;
}
