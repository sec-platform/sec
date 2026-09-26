import { createHash } from 'node:crypto';

/** Git's object storage format is independent of the application's digest
 * profile. This type validates names only, never object existence or authority. */
export type ObjectFormat = 'sha1' | 'sha256';

declare const objectIdBrand: unique symbol;
export type ObjectId<Format extends ObjectFormat = ObjectFormat> =
  string & { readonly [objectIdBrand]: Format };

const NON_LOWERCASE_HEX = /[^0-9a-f]/u;

export function isObjectFormat(value: unknown): value is ObjectFormat {
  return value === 'sha1' || value === 'sha256';
}

/** A boundary with an observed repository format must require that exact
 * format. Without a format this checks only the supported wire grammar;
 * it must not be used to infer how a repository stores its objects.
 * Zero names remain syntactically valid for existing Git CAS/null protocols;
 * the operation owner determines whether a zero sentinel is legal there. */
export function isObjectId<Format extends ObjectFormat>(
  value: unknown,
  format: Format
): value is ObjectId<Format>;
export function isObjectId(value: unknown): value is ObjectId;
export function isObjectId(value: unknown, format?: ObjectFormat): value is ObjectId {
  if (format !== undefined && !isObjectFormat(format)) return false;
  if (typeof value !== 'string') return false;
  const lengthMatches = format === 'sha1' ? value.length === 40
    : format === 'sha256' ? value.length === 64
    : value.length === 40 || value.length === 64;
  return lengthMatches && !NON_LOWERCASE_HEX.test(value);
}

/** Parsing a typed repository-bound name always requires the format. */
export function parseObjectId<Format extends ObjectFormat>(
  value: unknown,
  format: Format
): ObjectId<Format> {
  if (!isObjectFormat(format) || !isObjectId(value, format)) {
    throw new TypeError('Git object ID does not match its required repository format');
  }
  return value;
}
/** Compute the exact Git blob object name for one repository object format.
 * This is Git object identity, not an application content digest. The Git
 * header and raw bytes are hashed exactly as stored by Git. */
export function gitBlobObjectId<Format extends ObjectFormat>(
  format: Format,
  bytes: Uint8Array
): ObjectId<Format> {
  if (!isObjectFormat(format)) throw new TypeError('Unsupported Git object format');
  const hash = createHash(format);
  hash.update(`blob ${bytes.byteLength}\0`);
  hash.update(bytes);
  return parseObjectId(hash.digest('hex'), format);
}
