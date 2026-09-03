import { types as utilTypes } from 'node:util';

export const BUSINESS_TIMEZONE = 'Asia/Shanghai';
export const LOCAL_DATE_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/u;
export const LOCAL_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/u;
export const LOCAL_DATETIME_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u;
export const EPOCH_MS_STRING_PATTERN = /^(0|[1-9][0-9]*)$/u;

export const TIME_CONTRACT_ERROR_CODES = Object.freeze({
  localDateInvalid: 'LOCAL_DATE_INVALID',
  localTimeInvalid: 'LOCAL_TIME_INVALID',
  localDateTimeInvalid: 'LOCAL_DATETIME_INVALID',
  epochMsInvalid: 'EPOCH_MS_STRING_INVALID',
  epochMsOutOfRange: 'EPOCH_MS_OUT_OF_RANGE',
});

export class TimeContractError extends TypeError {
  constructor(code) {
    super(code);
    this.name = 'TimeContractError';
    this.code = code;
  }
}

function fail(code) {
  throw new TimeContractError(code);
}

function plainPrimitiveString(value, code) {
  if (typeof value !== 'string' || utilTypes.isProxy(value)) fail(code);
  return value;
}

function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validCalendarDate(year, month, day) {
  if (year < 1) return false;
  const maximum = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= maximum;
}

function calendarParts(value, pattern, code) {
  const text = plainPrimitiveString(value, code);
  const match = pattern.exec(text);
  if (!match) fail(code);
  const [date] = text.split(' ');
  const [yearText, monthText, dayText] = date.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!validCalendarDate(year, month, day)) fail(code);
  return text;
}

export function assertLocalDate(value) {
  return calendarParts(value, LOCAL_DATE_PATTERN, TIME_CONTRACT_ERROR_CODES.localDateInvalid);
}

export function assertLocalTime(value) {
  const text = plainPrimitiveString(value, TIME_CONTRACT_ERROR_CODES.localTimeInvalid);
  if (!LOCAL_TIME_PATTERN.test(text)) fail(TIME_CONTRACT_ERROR_CODES.localTimeInvalid);
  return text;
}

export function assertLocalDateTime(value) {
  return calendarParts(value, LOCAL_DATETIME_PATTERN, TIME_CONTRACT_ERROR_CODES.localDateTimeInvalid);
}

export function assertEpochMsString(value) {
  const text = plainPrimitiveString(value, TIME_CONTRACT_ERROR_CODES.epochMsInvalid);
  if (!EPOCH_MS_STRING_PATTERN.test(text)) fail(TIME_CONTRACT_ERROR_CODES.epochMsInvalid);
  try {
    BigInt(text);
  } catch {
    fail(TIME_CONTRACT_ERROR_CODES.epochMsInvalid);
  }
  return text;
}

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  calendar: 'iso8601',
  numberingSystem: 'latn',
  timeZone: BUSINESS_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partMap(parts) {
  const values = Object.create(null);
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return values;
}

export function formatEpochMsToShanghaiLocal(value) {
  const text = assertEpochMsString(value);
  const epoch = BigInt(text);
  if (epoch > 8_640_000_000_000_000n) fail(TIME_CONTRACT_ERROR_CODES.epochMsOutOfRange);
  const instant = new Date(Number(epoch));
  if (!Number.isFinite(instant.getTime())) fail(TIME_CONTRACT_ERROR_CODES.epochMsOutOfRange);
  const parts = partMap(shanghaiFormatter.formatToParts(instant));
  return assertLocalDateTime(
    `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  );
}

function daysFromCivil(year, month, day) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function shanghaiLocalToEpochMs(value) {
  const local = assertLocalDateTime(value);
  const [date, time] = local.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const utcSeconds = BigInt(daysFromCivil(year, month, day)) * 86_400n
    + BigInt(hour * 3600 + minute * 60 + second)
    - 28_800n;
  if (utcSeconds < 0n) fail(TIME_CONTRACT_ERROR_CODES.epochMsOutOfRange);
  return assertEpochMsString(String(utcSeconds * 1000n));
}

export function addEpochMilliseconds(value, deltaMs) {
  const epoch = BigInt(assertEpochMsString(value));
  if (!Number.isSafeInteger(deltaMs)) fail(TIME_CONTRACT_ERROR_CODES.epochMsInvalid);
  const result = epoch + BigInt(deltaMs);
  if (result < 0n) fail(TIME_CONTRACT_ERROR_CODES.epochMsOutOfRange);
  return assertEpochMsString(String(result));
}

export function nowShanghaiLocal({ nowEpochMs = String(Date.now()) } = {}) {
  return formatEpochMsToShanghaiLocal(assertEpochMsString(nowEpochMs));
}

export function compareLocalDateTime(left, right) {
  const a = assertLocalDateTime(left);
  const b = assertLocalDateTime(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function localDateTimeToDisplay(value) {
  return assertLocalDateTime(value).slice(0, 16);
}
