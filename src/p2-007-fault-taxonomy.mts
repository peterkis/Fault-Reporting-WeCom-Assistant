export interface SymptomAlias { alias: string; symptom_code: string; assertion?: string }
export interface FaultDictionary { schema_version: string; symptom_aliases: SymptomAlias[] }
export type FaultTaxonomyResolver = ReturnType<typeof createFaultTaxonomyResolver>;
import { fileURLToPath } from 'node:url';

import {
  P2_007_ERROR_CODES,
  deepFreeze,
  failP2007,
  normalizeHospitalText,
  readJsonConfig,
  uniqueSorted,
} from './p2-007-domain-utils.mjs';

export const DEFAULT_FAULT_ALIAS_PATH = fileURLToPath(new URL(
  '../config_examples/p2-007-alias-dictionary.example.json',
  import.meta.url,
));

const BUILTIN_SYMPTOMS = Object.freeze([
  ['卡顿', 'PERFORMANCE.SLOW'],
  ['卡', 'PERFORMANCE.SLOW'],
  ['登录失败', 'AUTH.LOGIN_FAILED'],
  ['无法登录', 'AUTH.LOGIN_FAILED'],
  ['login failed', 'AUTH.LOGIN_FAILED'],
  ['打不开', 'AVAILABILITY.UNAVAILABLE'],
  ['无法访问', 'AVAILABILITY.UNAVAILABLE'],
  ['打印失败', 'PRINT.NO_OUTPUT'],
  ['网络不通', 'NETWORK.DISCONNECTED'],
  ['网络断开', 'NETWORK.DISCONNECTED'],
] as const);

export function faultTypeForSymptom(symptomCode: unknown) {
  if (typeof symptomCode !== 'string') return 'UNKNOWN_FAILURE';
  if (symptomCode.startsWith('AUTH.')) return 'AUTHENTICATION_FAILURE';
  if (symptomCode.startsWith('PERFORMANCE.')) return 'PERFORMANCE_DEGRADATION';
  if (symptomCode.startsWith('PRINT.') || symptomCode.startsWith('OUTPUT.')) return 'OUTPUT_FAILURE';
  if (symptomCode.startsWith('NETWORK.')) return 'CONNECTIVITY_FAILURE';
  if (symptomCode.startsWith('AVAILABILITY.') || symptomCode.startsWith('UI.')) return 'ACCESS_FAILURE';
  if (symptomCode.startsWith('TRANSACTION.')) return 'TRANSACTION_FAILURE';
  if (symptomCode.startsWith('DATA.')) return 'DATA_FAILURE';
  if (symptomCode.startsWith('HARDWARE.')) return 'HARDWARE_FAILURE';
  return 'OTHER_FAILURE';
}

export function createFaultTaxonomyResolver({ dictionary }: { dictionary?: unknown } = {}) {
  const source = dictionary === undefined ? readJsonConfig(DEFAULT_FAULT_ALIAS_PATH) as FaultDictionary : dictionary as FaultDictionary;
  if (!source || source.schema_version !== '1.0.0' || !Array.isArray(source.symptom_aliases)) {
    failP2007(P2_007_ERROR_CODES.configInvalid);
  }
  const seen = new Set();
  const entries = source.symptom_aliases.map((entry, index) => {
    const alias = typeof entry?.alias === 'string' ? normalizeHospitalText(entry.alias) : '';
    if (!alias || seen.has(alias) || typeof entry.symptom_code !== 'string') failP2007(P2_007_ERROR_CODES.configInvalid);
    seen.add(alias);
    return {
      alias: entry.alias,
      normalized_alias: alias,
      symptom_code: entry.symptom_code,
      assertion: entry.assertion ?? 'AFFIRMED',
      rule_id: `SYMPTOM-${String(index + 1).padStart(3, '0')}`,
    };
  });
  for (const [index, [alias, symptomCode]] of BUILTIN_SYMPTOMS.entries()) {
    const normalizedAlias = normalizeHospitalText(alias);
    if (!seen.has(normalizedAlias)) entries.push({
      alias,
      normalized_alias: normalizedAlias,
      symptom_code: symptomCode,
      assertion: 'AFFIRMED',
      rule_id: `SYMPTOM-${String(800 + index).padStart(3, '0')}`,
    });
  }
  entries.sort((left, right) => right.normalized_alias.length - left.normalized_alias.length
    || left.rule_id.localeCompare(right.rule_id, 'en'));

  return deepFreeze({
    resolve(text: unknown) {
      if (typeof text !== 'string') failP2007(P2_007_ERROR_CODES.inputInvalid);
      const normalizedText = normalizeHospitalText(text);
      const rawMatches = entries.filter((entry) => normalizedText.includes(entry.normalized_alias));
      const matches: { symptom_code: string; fault_type: string; assertion: string; matched_alias: string; rule_id: string }[] = [];
      const coveredCodes = new Set();
      for (const entry of rawMatches) {
        const key = `${entry.symptom_code}:${entry.assertion}`;
        if (coveredCodes.has(key)) continue;
        coveredCodes.add(key);
        matches.push(deepFreeze({
          symptom_code: entry.symptom_code,
          fault_type: faultTypeForSymptom(entry.symptom_code),
          assertion: entry.assertion,
          matched_alias: entry.alias,
          rule_id: entry.rule_id,
        }));
      }
      const symptomCodes = uniqueSorted(matches
        .filter((match) => match.assertion !== 'NEGATED')
        .map((match) => match.symptom_code));
      return deepFreeze({
        original_text: text,
        normalized_text: normalizedText,
        symptom_codes: symptomCodes,
        fault_types: uniqueSorted(symptomCodes.map(faultTypeForSymptom)),
        matches,
      });
    },
  });
}

export function resolveFaultTaxonomy(text: unknown, options?: Parameters<typeof createFaultTaxonomyResolver>[0]) {
  return createFaultTaxonomyResolver(options).resolve(text);
}
