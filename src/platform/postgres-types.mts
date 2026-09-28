import { types as pgTypes } from 'pg';
import type { LocalDateTime } from '../../contracts/time_contracts.js';

type Format = 'text' | 'binary';
export interface PgParserSource extends StringPreservingPgTypes {}
export interface StringPreservingPgTypes {
  getTypeParser(oid: number, format?: 'text'): (value: string) => unknown;
  getTypeParser(oid: number, format: 'binary'): (value: Buffer) => unknown;
  getTypeParser(oid: number, format?: Format): ((value: string) => unknown) | ((value: Buffer) => unknown);
}
import {
  assertLocalDateTime,
  formatEpochMsToShanghaiLocal,
} from './time-contract.mjs';

export const STRING_PRESERVED_POSTGRES_OIDS = Object.freeze({
  int8: 20,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  tsrange: 3908,
});

const stringOids = new Set<number>(Object.values(STRING_PRESERVED_POSTGRES_OIDS));
const identity = (value: string): string => value;

const LEGACY_TIMESTAMPTZ_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?([+-])(\d{2})(?::?(\d{2}))?$/u;

export function postgresTimestampToLocalDateTime(value: unknown): LocalDateTime {
  try {
    return assertLocalDateTime(value);
  } catch {
    // Migration-only boundary: node-postgres preserves legacy timestamptz text
    // so no precision is lost by parsing through a JavaScript Date.
  }
  if (typeof value !== 'string') throw new TypeError('POSTGRES_TIMESTAMP_INVALID');
  const match = LEGACY_TIMESTAMPTZ_PATTERN.exec(value);
  if (!match) throw new TypeError('POSTGRES_TIMESTAMP_INVALID');
  const local = assertLocalDateTime(`${match[1]} ${match[2]}`);
  const [year, month, day, hour, minute, second] = (local.match(/\d+/gu) as [string, string, string, string, string, string]).map(Number) as [number, number, number, number, number, number];
  const offsetMinutes = Number(match[4]) * 60 + Number(match[5] ?? '0');
  if (offsetMinutes > 14 * 60) throw new TypeError('POSTGRES_TIMESTAMP_INVALID');
  const signedOffset = match[3] === '+' ? offsetMinutes : -offsetMinutes;
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second) - signedOffset * 60_000;
  return formatEpochMsToShanghaiLocal(String(epochMs));
}

export function createStringPreservingPgTypes(baseTypes: PgParserSource = pgTypes): StringPreservingPgTypes {
  if (!baseTypes || typeof baseTypes.getTypeParser !== 'function') {
    throw new TypeError('POSTGRES_TYPES_INVALID');
  }
  // The source contract guarantees callable parsers. This format overload assertion
  // only correlates text/binary inputs; parser outputs stay unknown.
  return Object.freeze({
    getTypeParser(oid: number, format: Format = 'text') {
      if (format === 'text' && stringOids.has(Number(oid))) return identity;
      return baseTypes.getTypeParser(oid, format);
    },
  }) as StringPreservingPgTypes;
}

export const stringPreservingPgTypes = createStringPreservingPgTypes();
