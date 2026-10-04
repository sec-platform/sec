/**
 * Canonicalize an operator-supplied ISO instant at a presentation boundary.
 *
 * Trusted records must continue to reject non-canonical timestamps. CLI and
 * PowerShell adapters may call this function before creating a record so the
 * .NET round-trip `o` form (seven fractional digits and an optional numeric
 * offset) is reduced to the one ECMAScript `Date#toISOString()` identity.
 * Native Date remains the parsing/canonicalization provider; this module owns
 * only the accepted boundary grammar and fail-closed calendar validation.
 */

const ISO_INSTANT_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3}|\d{7})(Z|[+-]\d{2}:\d{2})$/u;

export function canonicalizeIsoInstantInput(value: unknown, label = 'ISO-8601 instant'): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must use canonical ECMAScript or PowerShell round-trip ISO-8601 syntax.`);
  }
  const match = ISO_INSTANT_INPUT.exec(value);
  if (match === null) {
    throw new Error(`${label} must use canonical ECMAScript or PowerShell round-trip ISO-8601 syntax.`);
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number, number, number, number, number, number
  ];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  const zone = match[8]!;
  const zoneHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const zoneMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]!
      || hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) {
    throw new Error(`${label} is not a valid ISO-8601 instant.`);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.valueOf())) {
    throw new Error(`${label} is not a valid ISO-8601 instant.`);
  }
  return instant.toISOString();
}
