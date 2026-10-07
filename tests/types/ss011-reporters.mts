import type { ApprovedLimitedManifest } from '../../src/yxx-limited-write-contract.mjs';

const single: ApprovedLimitedManifest['reporter_aliases'] = ['A'];
const pair: ApprovedLimitedManifest['reporter_aliases'] = ['A', 'B'];
// @ts-expect-error -- A limited run must have at least the approved Reporter A.
const empty: ApprovedLimitedManifest['reporter_aliases'] = [];
// @ts-expect-error -- B alone is outside the two permitted approval shapes.
const bOnly: ApprovedLimitedManifest['reporter_aliases'] = ['B'];
// @ts-expect-error -- Reporter aliases cannot be duplicated to satisfy cardinality.
const duplicate: ApprovedLimitedManifest['reporter_aliases'] = ['A', 'A'];
// @ts-expect-error -- The existing A/B alias order is part of the contract.
const reversed: ApprovedLimitedManifest['reporter_aliases'] = ['B', 'A'];
// @ts-expect-error -- No third Reporter alias is permitted.
const extended: ApprovedLimitedManifest['reporter_aliases'] = ['A', 'B', 'C'];
// @ts-expect-error -- A single Reporter still requires two approved internal principals.
const singlePrincipal: ApprovedLimitedManifest['principal_ids'] = ['synthetic-principal'];
void [single, pair, empty, bOnly, duplicate, reversed, extended, singlePrincipal];
