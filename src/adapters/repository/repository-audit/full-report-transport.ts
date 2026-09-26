const STRING_PREFIX = '~sec:utf16:v1:';
const UTF8_PREFIX = `${STRING_PREFIX}utf8:`;
const UTF16_PREFIX = `${STRING_PREFIX}utf16le:`;

export const REPOSITORY_AUDIT_FULL_REPORT_SCHEMA = 'repository-audit-full-report-v1' as const;
export const REPOSITORY_AUDIT_FULL_REPORT_STRING_ENCODING = 'sec-utf16-reversible-v1' as const;

export type RepositoryAuditFullReportEnvelope = Readonly<{
  schema: typeof REPOSITORY_AUDIT_FULL_REPORT_SCHEMA;
  stringEncoding: typeof REPOSITORY_AUDIT_FULL_REPORT_STRING_ENCODING;
  report: unknown;
}>;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function encodeString(value: string): string {
  if (hasUnpairedSurrogate(value)) {
    return `${UTF16_PREFIX}${Buffer.from(value, 'utf16le').toString('base64')}`;
  }
  if (value.startsWith(STRING_PREFIX)) {
    return `${UTF8_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`;
  }
  return value;
}

function decodeString(value: string): string {
  if (value.startsWith(UTF16_PREFIX)) {
    return Buffer.from(value.slice(UTF16_PREFIX.length), 'base64').toString('utf16le');
  }
  if (value.startsWith(UTF8_PREFIX)) {
    return Buffer.from(value.slice(UTF8_PREFIX.length), 'base64').toString('utf8');
  }
  if (value.startsWith(STRING_PREFIX)) {
    throw new Error('Repository audit full report contains an unknown UTF-16 transport escape.');
  }
  return value;
}

function transform(value: unknown, strings: (value: string) => string): unknown {
  if (typeof value === 'string') return strings(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => transform(entry, strings));
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const encodedKey = strings(key);
    if (Object.hasOwn(output, encodedKey)) {
      throw new Error('Repository audit UTF-16 transport produced a duplicate object key.');
    }
    output[encodedKey] = transform(entry, strings);
  }
  return output;
}

export function encodeRepositoryAuditFullReport(report: unknown): RepositoryAuditFullReportEnvelope {
  return Object.freeze({
    schema: REPOSITORY_AUDIT_FULL_REPORT_SCHEMA,
    stringEncoding: REPOSITORY_AUDIT_FULL_REPORT_STRING_ENCODING,
    report: transform(report, encodeString)
  });
}

export function decodeRepositoryAuditFullReport(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Repository audit full report envelope must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== REPOSITORY_AUDIT_FULL_REPORT_SCHEMA
      || record.stringEncoding !== REPOSITORY_AUDIT_FULL_REPORT_STRING_ENCODING
      || !Object.hasOwn(record, 'report')) {
    throw new Error('Repository audit full report envelope is incompatible.');
  }
  return transform(record.report, decodeString);
}
