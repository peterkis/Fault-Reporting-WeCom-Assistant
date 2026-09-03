import { fileURLToPath } from 'node:url';

import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  normalizeHospitalText,
  readJsonConfig,
  sha256Canonical,
  uniqueSorted,
} from './p2-007-domain-utils.mjs';
import { loadServiceCatalog } from './p2-007-service-catalog.mjs';

export const DEFAULT_ALIAS_DICTIONARY_PATH = fileURLToPath(new URL(
  '../config_examples/p2-007-alias-dictionary.example.json',
  import.meta.url,
));

const BUILTIN_SERVICE_ALIASES = Object.freeze([
  { alias: 'HIS', candidate_service_codes: ['CLINICAL.OUTPATIENT_WORKSTATION', 'CLINICAL.INPATIENT_WORKSTATION'], selection_policy: 'REQUIRE_CONTEXT' },
  { alias: '医生站', candidate_service_codes: ['CLINICAL.OUTPATIENT_WORKSTATION', 'CLINICAL.INPATIENT_WORKSTATION'], selection_policy: 'REQUIRE_CONTEXT' },
  { alias: '医生工作站', candidate_service_codes: ['CLINICAL.OUTPATIENT_WORKSTATION', 'CLINICAL.INPATIENT_WORKSTATION'], selection_policy: 'REQUIRE_CONTEXT' },
  { alias: '挂号系统', candidate_service_codes: ['ACCESS.REGISTRATION'], selection_policy: 'AUTO_SELECT' },
  { alias: 'LIS', candidate_service_codes: ['DIAG.LAB_RESULT_VIEW'], selection_policy: 'AUTO_SELECT' },
  { alias: '网络', candidate_service_codes: ['NETWORK.ENDPOINT_ACCESS'], selection_policy: 'AUTO_SELECT' },
]);

function validateDictionary(input, catalog) {
  const dictionary = assertPlainJson(input, {
    errorCode: P2_007_ERROR_CODES.configInvalid,
    maxDepth: 12,
    maxNodes: 100_000,
    maxArrayLength: 20_000,
    maxStringLength: 100_000,
  });
  if (
    dictionary.schema_version !== '1.0.0'
    || typeof dictionary.alias_set_id !== 'string'
    || typeof dictionary.alias_set_version !== 'string'
    || !Array.isArray(dictionary.service_aliases)
    || !Array.isArray(dictionary.symptom_aliases)
  ) failP2007(P2_007_ERROR_CODES.configInvalid);

  const serviceAliases = new Set();
  for (const entry of dictionary.service_aliases) {
    const alias = typeof entry?.alias === 'string' ? normalizeHospitalText(entry.alias) : '';
    if (
      !alias || serviceAliases.has(alias) || !Array.isArray(entry.candidate_service_codes)
      || (entry.candidate_service_codes.length === 0 && entry.selection_policy !== 'NEVER_AUTO_SELECT')
    ) {
      failP2007(P2_007_ERROR_CODES.configInvalid);
    }
    serviceAliases.add(alias);
    for (const code of entry.candidate_service_codes) {
      if (!catalog.lookupService(code)) failP2007(P2_007_ERROR_CODES.configInvalid);
    }
  }

  const symptomAliases = new Set();
  for (const entry of dictionary.symptom_aliases) {
    const alias = typeof entry?.alias === 'string' ? normalizeHospitalText(entry.alias) : '';
    if (!alias || symptomAliases.has(alias) || typeof entry.symptom_code !== 'string') {
      failP2007(P2_007_ERROR_CODES.configInvalid);
    }
    symptomAliases.add(alias);
  }
  return deepFreeze(dictionary);
}

function occurs(normalizedText, normalizedAlias) {
  if (/^[a-z0-9.+_-]+$/u.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'u').test(normalizedText);
  }
  return normalizedText.includes(normalizedAlias);
}

function matchSort(left, right) {
  return right.normalized_alias.length - left.normalized_alias.length
    || left.rule_id.localeCompare(right.rule_id, 'en');
}

export function createAliasResolver({ dictionary, catalog = loadServiceCatalog() } = {}) {
  const safeDictionary = validateDictionary(
    dictionary === undefined ? readJsonConfig(DEFAULT_ALIAS_DICTIONARY_PATH) : dictionary,
    catalog,
  );
  const existing = new Set(safeDictionary.service_aliases.map((entry) => normalizeHospitalText(entry.alias)));
  const serviceEntries = safeDictionary.service_aliases.map((entry, index) => ({
    ...entry,
    normalized_alias: normalizeHospitalText(entry.alias),
    rule_id: `ALIAS-${String(index + 1).padStart(3, '0')}`,
  }));
  for (const [index, entry] of BUILTIN_SERVICE_ALIASES.entries()) {
    const normalizedAlias = normalizeHospitalText(entry.alias);
    if (!existing.has(normalizedAlias)) serviceEntries.push({
      ...entry,
      match_mode: 'PHRASE',
      case_sensitive: false,
      notes: 'P2-007 runtime compatibility alias',
      normalized_alias: normalizedAlias,
      rule_id: `ALIAS-${String(900 + index).padStart(3, '0')}`,
    });
  }
  serviceEntries.sort(matchSort);

  return deepFreeze({
    alias_set_id: safeDictionary.alias_set_id,
    alias_set_version: safeDictionary.alias_set_version,
    alias_set_hash: sha256Canonical(safeDictionary),
    resolve(text) {
      const originalText = typeof text === 'string' ? text : failP2007(P2_007_ERROR_CODES.inputInvalid);
      const normalizedText = normalizeHospitalText(originalText);
      const matches = serviceEntries
        .filter((entry) => occurs(normalizedText, entry.normalized_alias))
        .map((entry) => {
          const matchIndex = normalizedText.lastIndexOf(entry.normalized_alias);
          const prefix = normalizedText.slice(Math.max(0, matchIndex - 6), matchIndex);
          return deepFreeze({
            canonical: entry.candidate_service_codes.length === 1 ? entry.candidate_service_codes[0] : null,
            candidate_service_codes: [...entry.candidate_service_codes],
            matched_alias: entry.alias,
            normalized_alias: entry.normalized_alias,
            match_index: matchIndex,
            negated: /(?:不是|并非|不像|搞错了)[,， ]*$/u.test(prefix),
            rule_id: entry.rule_id,
            selection_policy: entry.selection_policy,
          });
        });
      const correctionIndex = Math.max(...['不是,是', '不是，是', '应该是', '改为', '前面说错了']
        .map((marker) => normalizedText.lastIndexOf(normalizeHospitalText(marker))));
      const eligible = matches.filter((match) => !match.negated && (correctionIndex < 0 || match.match_index > correctionIndex));
      const selectionPool = eligible.length > 0 ? eligible : matches.filter((match) => !match.negated);
      const longestLength = selectionPool[0]?.normalized_alias.length ?? 0;
      const strongest = selectionPool.filter((match) => match.normalized_alias.length === longestLength);
      const candidates = uniqueSorted(strongest.flatMap((match) => match.candidate_service_codes));
      const autoSelected = strongest.find((match) => match.selection_policy === 'AUTO_SELECT' && match.canonical);
      const selected = candidates.length === 1 ? candidates[0] : autoSelected?.canonical ?? null;
      return deepFreeze({
        original_text: originalText,
        normalized_text: normalizedText,
        canonical: selected,
        matched_alias: strongest[0]?.matched_alias ?? null,
        rule_id: strongest[0]?.rule_id ?? null,
        selected_service_code: selected,
        candidate_service_codes: candidates,
        matches,
        clarification_needed: matches.length > 0 && selected === null,
      });
    },
  });
}

export function resolveAlias(text, options) {
  return createAliasResolver(options).resolve(text);
}
