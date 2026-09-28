// Deliberate legacy MJS caller used only by the migration canary test.
import { canary, moduleIdentity } from '../../../src/migration-canary.mjs';
export const callFromLegacy = () => canary({ label: 'legacy', sequence: 7 });
export const legacyIdentity = moduleIdentity;
