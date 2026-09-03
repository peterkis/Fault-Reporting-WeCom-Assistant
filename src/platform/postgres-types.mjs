import { types as pgTypes } from 'pg';

export const STRING_PRESERVED_POSTGRES_OIDS = Object.freeze({
  int8: 20,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  tsrange: 3908,
});

const stringOids = new Set(Object.values(STRING_PRESERVED_POSTGRES_OIDS));
const identity = (value) => value;

export function createStringPreservingPgTypes(baseTypes = pgTypes) {
  if (!baseTypes || typeof baseTypes.getTypeParser !== 'function') {
    throw new TypeError('POSTGRES_TYPES_INVALID');
  }
  return Object.freeze({
    getTypeParser(oid, format = 'text') {
      if (format === 'text' && stringOids.has(Number(oid))) return identity;
      return baseTypes.getTypeParser(oid, format);
    },
  });
}

export const stringPreservingPgTypes = createStringPreservingPgTypes();
