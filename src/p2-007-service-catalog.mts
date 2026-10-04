export interface ServiceDefinition { service_code: string; name_zh: string; aliases: string[]; required_fields: string[]; transaction_stages: string[]; common_symptom_codes: string[]; enabled: boolean; default_owner_team?: string }
export interface ServiceDomain { domain_code: string; name_zh: string; services: ServiceDefinition[] }
export interface ServiceCatalogData { schema_version: string; catalog_id: string; catalog_version: string; domains: ServiceDomain[]; taxonomies: { symptom_codes: { code: string }[] } }
export type CatalogService = ServiceDefinition & { category: string; category_name_zh: string };
export type ServiceCatalog = ReturnType<typeof createServiceCatalog>;
import { fileURLToPath } from 'node:url';

import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  readJsonConfig,
  sha256Canonical,
} from './p2-007-domain-utils.mjs';

export const DEFAULT_SERVICE_CATALOG_PATH = fileURLToPath(new URL(
  '../config_examples/p2-007-service-catalog.example.json',
  import.meta.url,
));

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/u;
const DOMAIN_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateServiceCatalog(input: unknown): ServiceCatalogData {
  const catalog = assertPlainJson(input, {
    errorCode: P2_007_ERROR_CODES.configInvalid,
    maxDepth: 16,
    maxNodes: 100_000,
    maxArrayLength: 20_000,
    maxStringLength: 100_000,
  }) as ServiceCatalogData;
  if (
    catalog.schema_version !== '1.0.0'
    || !nonEmptyString(catalog.catalog_id)
    || !nonEmptyString(catalog.catalog_version)
    || !Array.isArray(catalog.domains)
    || catalog.domains.length === 0
  ) failP2007(P2_007_ERROR_CODES.configInvalid);

  const domainCodes = new Set();
  const serviceCodes = new Set();
  for (const domain of catalog.domains) {
    if (
      !domain || typeof domain !== 'object'
      || !DOMAIN_PATTERN.test(domain.domain_code)
      || !nonEmptyString(domain.name_zh)
      || !Array.isArray(domain.services)
      || domain.services.length === 0
      || domainCodes.has(domain.domain_code)
    ) failP2007(P2_007_ERROR_CODES.configInvalid);
    domainCodes.add(domain.domain_code);

    for (const service of domain.services) {
      if (
        !service || typeof service !== 'object'
        || !CODE_PATTERN.test(service.service_code)
        || !nonEmptyString(service.name_zh)
        || !Array.isArray(service.aliases)
        || !Array.isArray(service.required_fields)
        || !Array.isArray(service.transaction_stages)
        || !Array.isArray(service.common_symptom_codes)
        || typeof service.enabled !== 'boolean'
        || serviceCodes.has(service.service_code)
      ) failP2007(P2_007_ERROR_CODES.configInvalid);
      serviceCodes.add(service.service_code);
      const aliases = new Set();
      for (const alias of service.aliases) {
        if (!nonEmptyString(alias) || aliases.has(alias.normalize('NFKC').toLocaleLowerCase('zh-CN'))) {
          failP2007(P2_007_ERROR_CODES.configInvalid);
        }
        aliases.add(alias.normalize('NFKC').toLocaleLowerCase('zh-CN'));
      }
    }
  }
  return deepFreeze(catalog);
}

export function createServiceCatalog(input: unknown) {
  const catalog = validateServiceCatalog(input);
  const byServiceCode = new Map<string, CatalogService>();
  const byDomainCode = new Map<string, ServiceDomain>();
  for (const domain of catalog.domains) {
    byDomainCode.set(domain.domain_code, domain);
    for (const service of domain.services) {
      byServiceCode.set(service.service_code, deepFreeze({
        ...service,
        category: domain.domain_code,
        category_name_zh: domain.name_zh,
      }));
    }
  }

  return deepFreeze({
    catalog_id: catalog.catalog_id,
    catalog_version: catalog.catalog_version,
    service_count: byServiceCode.size,
    category_count: byDomainCode.size,
    catalog_hash: sha256Canonical(catalog),
    raw: catalog,
    lookupService(serviceCode: unknown) {
      if (typeof serviceCode !== 'string') return null;
      return byServiceCode.get(serviceCode.toUpperCase()) ?? null;
    },
    lookupCategory(value: unknown) {
      if (typeof value !== 'string') return null;
      const code = value.toUpperCase();
      const domain = byDomainCode.get(code);
      if (domain) return deepFreeze({
        category: domain.domain_code,
        category_name_zh: domain.name_zh,
        service_codes: domain.services.map((service) => service.service_code),
      });
      const service = byServiceCode.get(code);
      return service ? deepFreeze({
        category: service.category,
        category_name_zh: service.category_name_zh,
        service_codes: (byDomainCode.get(service.category) as ServiceDomain).services.map((item) => item.service_code),
      }) : null;
    },
    listServices({ enabledOnly = true } = {}) {
      return [...byServiceCode.values()].filter((service) => !enabledOnly || service.enabled);
    },
    listCategories() {
      return [...byDomainCode.values()].map((domain) => deepFreeze({
        category: domain.domain_code,
        category_name_zh: domain.name_zh,
      }));
    },
  });
}

export function loadServiceCatalog({ path = DEFAULT_SERVICE_CATALOG_PATH, catalog }: { path?: string; catalog?: unknown } = {}) {
  return createServiceCatalog(catalog === undefined ? readJsonConfig(path) : catalog);
}
