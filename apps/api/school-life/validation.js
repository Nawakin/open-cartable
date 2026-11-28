import { uuidPattern } from '../auth/credentials.js';
import { isInstant } from '../agenda/period.js';

export const uuid = { type: 'string', pattern: uuidPattern.source };
export const dayField = { type: 'string', minLength: 10, maxLength: 10 };
export const instantField = { type: 'string', maxLength: 30 };
export const text = (maxLength) => ({ type: 'string', maxLength });
export const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const shape = (properties, required = Object.keys(properties)) =>
  ({ type: 'object', required, additionalProperties: false, properties });
export const schoolDaySql = "(statement_timestamp() AT TIME ZONE 'Europe/Paris')::date";

export function invalid(statusCode = 400) {
  throw Object.assign(new Error('Action scolaire indisponible.'), { statusCode });
}

export function plain(input, required = false) {
  const value = input.trim();
  if ((required && !value) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) invalid();
  return value;
}

export function validPublicationAt(value) {
  if (!isInstant(value)) return false;
  const delay = Date.parse(value) - Date.now();
  return delay > 0 && delay <= 366 * 24 * 60 * 60 * 1000;
}
