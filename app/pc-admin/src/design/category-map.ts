import {CircleHelp, Globe, KeyRound, Monitor, PillBottle, Printer, Receipt, Route, ScanLine, SlidersHorizontal, Stethoscope, Ticket, Wifi, type LucideIcon} from 'lucide-react';

export interface CategoryPresentation {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
  readonly icon: LucideIcon;
  readonly border: string | null;
}

/** Visual aliases for ServiceCatalog domains; never a replacement service catalog. */
export const categoryMap = {
  CLINICAL_CORE: {label: '核心临床与病历', bg: 'var(--cat-clinical-bg)', fg: 'var(--cat-clinical-fg)', icon: Stethoscope, border: null},
  PATIENT_ACCESS: {label: '挂号、签到与叫号', bg: 'var(--cat-access-bg)', fg: 'var(--cat-access-fg)', icon: Ticket, border: null},
  DIAGNOSTIC: {label: '检验与影像结果', bg: 'var(--cat-diag-bg)', fg: 'var(--cat-diag-fg)', icon: ScanLine, border: null},
  PHARMACY_MEDICATION: {label: '药品与审方', bg: 'var(--cat-pharm-bg)', fg: 'var(--cat-pharm-fg)', icon: PillBottle, border: null},
  BILLING_INSURANCE: {label: '收费与医保', bg: 'var(--cat-billing-bg)', fg: 'var(--cat-billing-fg)', icon: Receipt, border: null},
  INTERNET_HOSPITAL: {label: '互联网医院', bg: 'var(--cat-online-bg)', fg: 'var(--cat-online-fg)', icon: Globe, border: null},
  ENDPOINT_PRINT: {label: '终端、显示与打印', bg: 'var(--cat-endpoint-bg)', fg: 'var(--cat-endpoint-fg)', icon: Monitor, border: null},
  NETWORK_INFRASTRUCTURE: {label: '网络与连接', bg: 'var(--cat-network-bg)', fg: 'var(--cat-network-fg)', icon: Wifi, border: null},
  IDENTITY_SECURITY: {label: '身份、签名与安全', bg: 'var(--cat-identity-bg)', fg: 'var(--cat-identity-fg)', icon: KeyRound, border: null},
  CONFIG_DATA: {label: '主数据与配置', bg: 'var(--cat-config-bg)', fg: 'var(--cat-config-fg)', icon: SlidersHorizontal, border: null},
  CROSS_DEPARTMENT_ROUTING: {label: '非 IT 与跨部门转办', bg: 'var(--cat-route-bg)', fg: 'var(--cat-route-fg)', icon: Route, border: null},
} as const satisfies Readonly<Record<string, CategoryPresentation>>;

export const unclassifiedCategory: CategoryPresentation = {
  label: '未分类', bg: 'var(--cat-unclassified-bg)', fg: 'var(--cat-unclassified-fg)', icon: CircleHelp, border: 'var(--cat-unclassified-border)',
};

const serviceIcons: Readonly<Record<string, {domain: keyof typeof categoryMap; icon: LucideIcon}>> = {
  'PRINT.PRINTER_DEVICE': {domain: 'ENDPOINT_PRINT', icon: Printer},
  'PRINT.PRINT_RENDERING': {domain: 'ENDPOINT_PRINT', icon: Printer},
  'DIAG.LAB_RESULT_PRINT': {domain: 'DIAGNOSTIC', icon: Printer},
};

export function categoryOf(domainCode: string | null | undefined, serviceCode?: string | null): CategoryPresentation {
  if (!domainCode || !Object.hasOwn(categoryMap, domainCode)) return unclassifiedCategory;
  const base = categoryMap[domainCode as keyof typeof categoryMap];
  const service = serviceCode && Object.hasOwn(serviceIcons, serviceCode) ? serviceIcons[serviceCode] : undefined;
  return service?.domain === domainCode ? {...base, icon: service.icon} : base;
}
