/** T01-only compilation canary. Not imported by a production entry. Remove after T03. */
export interface CanaryInput { label: string; sequence: number }
export const moduleIdentity = Object.freeze({ kind: 'migration-canary' });
export function canary(input: CanaryInput): string { return `${input.label}:${input.sequence}`; }
