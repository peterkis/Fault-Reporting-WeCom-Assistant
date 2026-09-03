import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { types as utilTypes } from 'node:util';

export const P2_007_ERROR_CODES = Object.freeze({
  inputInvalid: 'P2_007_INPUT_INVALID',
  configInvalid: 'P2_007_CONFIG_INVALID',
  limitExceeded: 'P2_007_LIMIT_EXCEEDED',
  localDateTimeInvalid: 'P2_007_LOCAL_DATETIME_INVALID',
});

export class P2007DomainError extends TypeError {
  constructor(code) {
    super(code);
    this.name = 'P2007DomainError';
    this.code = code;
  }
}

export function failP2007(code) {
  throw new P2007DomainError(code);
}

const POLLUTED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function assertPlainJson(value, {
  errorCode = P2_007_ERROR_CODES.inputInvalid,
  maxDepth = 12,
  maxNodes = 20_000,
  maxArrayLength = 5_000,
  maxStringLength = 20_000,
} = {}) {
  let nodes = 0;
  const ancestors = new Set();

  function visit(current, depth) {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) failP2007(P2_007_ERROR_CODES.limitExceeded);
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      if (current.length > maxStringLength) failP2007(P2_007_ERROR_CODES.limitExceeded);
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) failP2007(errorCode);
      return current;
    }
    if (typeof current !== 'object' || utilTypes.isProxy(current)) failP2007(errorCode);
    if (ancestors.has(current)) failP2007(errorCode);

    let prototype;
    let descriptors;
    let symbols;
    try {
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current);
      symbols = Object.getOwnPropertySymbols(current);
    } catch {
      failP2007(errorCode);
    }
    if (symbols.length > 0) failP2007(errorCode);
    const isArray = Array.isArray(current);
    if (prototype !== (isArray ? Array.prototype : Object.prototype)) failP2007(errorCode);
    if (isArray) {
      if (current.length > maxArrayLength) failP2007(P2_007_ERROR_CODES.limitExceeded);
      const descriptorKeys = Object.keys(descriptors);
      if (
        !Object.hasOwn(descriptors, 'length')
        || descriptorKeys.some((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/u.test(key))
        || Array.from({ length: current.length }, (_, index) => String(index)).some((key) => !Object.hasOwn(descriptors, key))
      ) failP2007(errorCode);
    }

    ancestors.add(current);
    const copy = isArray ? [] : {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (POLLUTED_KEYS.has(key) || !Object.hasOwn(descriptor, 'value')) failP2007(errorCode);
      copy[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(current);
    return copy;
  }

  return visit(value, 0);
}

export function readJsonConfig(path) {
  if (typeof path !== 'string' || path.length === 0) failP2007(P2_007_ERROR_CODES.configInvalid);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    failP2007(P2_007_ERROR_CODES.configInvalid);
  }
  return assertPlainJson(parsed, {
    errorCode: P2_007_ERROR_CODES.configInvalid,
    maxDepth: 16,
    maxNodes: 100_000,
    maxArrayLength: 20_000,
    maxStringLength: 100_000,
  });
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function canonicalJson(value) {
  const safe = assertPlainJson(value);
  function encode(current) {
    if (current === null || typeof current !== 'object') return JSON.stringify(current);
    if (Array.isArray(current)) return `[${current.map(encode).join(',')}]`;
    return `{${Object.keys(current).sort().map((key) => `${JSON.stringify(key)}:${encode(current[key])}`).join(',')}}`;
  }
  return encode(safe);
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sha256Text(value) {
  if (typeof value !== 'string') failP2007(P2_007_ERROR_CODES.inputInvalid);
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeHospitalText(value) {
  if (typeof value !== 'string' || utilTypes.isProxy(value) || value.length > 20_000) {
    failP2007(P2_007_ERROR_CODES.inputInvalid);
  }
  return value
    .normalize('NFKC')
    .replace(/[，、；：！？。]/gu, (character) => ({
      '，': ',', '、': ',', '；': ';', '：': ':', '！': '!', '？': '?', '。': '.',
    })[character])
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('zh-CN');
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}
