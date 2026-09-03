declare const localDateBrand: unique symbol;
declare const localTimeBrand: unique symbol;
declare const localDateTimeBrand: unique symbol;
declare const physicalEpochMsBrand: unique symbol;

export type LocalDate = string & { readonly [localDateBrand]: 'LocalDate' };
export type LocalTime = string & { readonly [localTimeBrand]: 'LocalTime' };
export type LocalDateTime = string & { readonly [localDateTimeBrand]: 'Asia/Shanghai second precision' };
export type PhysicalEpochMs = string & { readonly [physicalEpochMsBrand]: 'non-negative epoch milliseconds' };
