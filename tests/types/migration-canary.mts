import { canary } from '../../src/migration-canary.mjs';
const valid: string = canary({ label: 'positive', sequence: 1 });
void valid;
// @ts-expect-error -- numeric sequence cannot accept an arbitrary string.
canary({ label: 'negative', sequence: '1' });
// @ts-expect-error -- required label cannot silently disappear.
canary({ sequence: 1 });
