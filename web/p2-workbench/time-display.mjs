const LOCAL_DATETIME_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u;

export function workbenchLocalDateTimeDisplay(value) {
  if (typeof value !== 'string' || !LOCAL_DATETIME_PATTERN.test(value)) {
    throw new TypeError('WORKBENCH_LOCAL_DATETIME_INVALID');
  }
  return value.slice(0, 16);
}
