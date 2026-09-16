/**
 * SEC Canonical Text Byte Census Contract (Issue #209 Phase A).
 *
 * Defines the classification, anomaly, and report types used by the canonical
 * SEC development text census to scan one captured committed Git tree and
 * classify each blob according to that tree's .gitattributes policy.
 *
 * Git blob bytes are the tracked source identity. Worktree materialization
 * is a separate concern handled by worktree-settlement-contract.ts.
 */

export const TEXT_BYTE_CENSUS_SCHEMA = 'sec-text-byte-census-v1' as const;

/**
 * Canonical classification of a tracked Git blob.
 *
 * - canonical-lf: .gitattributes declares `text eol=lf` and blob is LF.
 * - explicit-crlf: .gitattributes declares `text eol=crlf` and blob is CRLF.
 * - binary: .gitattributes declares `-text`.
 * - preserve-external: not covered by .gitattributes; external brownfield input
 *   whose original bytes must be preserved without normalization.
 * - unknown: cannot classify (attributes missing on governed extension,
 *   conflicting attributes, or unknown encoding). Fail-closed.
 */
export type TextByteClassification =
  | 'canonical-lf'
  | 'explicit-crlf'
  | 'binary'
  | 'preserve-external'
  | 'unknown';

/**
 * Observed line-ending shape in blob bytes.
 *
 * - lf: blob uses LF only.
 * - crlf: blob uses CRLF only.
 * - mixed: blob contains both LF and CRLF.
 * - none: blob has no line endings (empty or single-line without newline).
 */
export type TextByteLineEnding = 'lf' | 'crlf' | 'mixed' | 'none';

/**
 * Anomalies detected during census. Each is a structured finding, not a log string.
 *
 * - crlf-in-canonical-lf-blob: blob has CRLF/mixed but declared `text eol=lf`.
 * - lf-in-explicit-crlf-blob: blob has LF/mixed but declared `text eol=crlf`.
 * - mixed-endings: blob contains both LF and CRLF.
 * - utf8-bom: blob starts with UTF-8 BOM (EF BB BF).
 * - nul-byte: blob contains NUL (0x00), indicating binary content.
 * - unknown-encoding: blob is not valid UTF-8 and not declared binary.
 * - attributes-unsupported: Git resolved an attribute value outside the SEC policy vocabulary.
 */
export type TextByteAnomaly =
  | 'crlf-in-canonical-lf-blob'
  | 'lf-in-explicit-crlf-blob'
  | 'mixed-endings'
  | 'utf8-bom'
  | 'nul-byte'
  | 'unknown-encoding'
  | 'attributes-unsupported';

export const TEXT_BYTE_ANOMALIES = [
  'crlf-in-canonical-lf-blob',
  'lf-in-explicit-crlf-blob',
  'mixed-endings',
  'utf8-bom',
  'nul-byte',
  'unknown-encoding',
  'attributes-unsupported'
] as const satisfies readonly TextByteAnomaly[];

/**
 * Census entry for a single tracked file.
 */
export interface TextByteCensusEntry {
  /** Repository-relative POSIX path. */
  path: string;
  /** Classification determined by .gitattributes + blob bytes. */
  classification: TextByteClassification;
  /** Blob byte size. */
  byteSize: number;
  /** Full Git blob object ID: 40-hex SHA-1 or 64-hex SHA-256. */
  blobSha: string;
  /** Observed line-ending shape. */
  lineEnding: TextByteLineEnding;
  /** Structured anomalies detected. */
  anomalies: TextByteAnomaly[];
}

/**
 * Aggregate census report.
 */
export interface TextByteCensusReport {
  schema: typeof TEXT_BYTE_CENSUS_SCHEMA;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  /** Absolute normalized repository root. */
  repositoryRoot: string;
  /** Full .gitattributes Git blob object ID at census time. */
  gitattributesBlobSha: string | null;
  /** Total tracked files scanned. */
  totalFiles: number;
  /** Count per classification. */
  classificationCounts: Record<TextByteClassification, number>;
  /** Count per anomaly. */
  anomalyCounts: Record<TextByteAnomaly, number>;
  /** Entries with anomalies (empty if all clean). */
  flaggedEntries: TextByteCensusEntry[];
  /** True if any unknown classification or blocking anomaly was found. */
  failClosed: boolean;
}

/**
 * UTF-8 BOM prefix bytes.
 */
export const UTF8_BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);

/**
 * Classify blob bytes by .gitattributes declaration and observed shape.
 *
 * Returns the classification and observed anomalies. Pure function;
 * does not touch the filesystem.
 */
export function classifyBlobBytes(input: {
  path: string;
  bytes: Uint8Array;
  textAttr: 'set' | 'unset' | 'unspecified' | 'unsupported';
  eolAttr: 'lf' | 'crlf' | 'unspecified' | 'unsupported';
}): { classification: TextByteClassification; lineEnding: TextByteLineEnding; anomalies: TextByteAnomaly[] } {
  const anomalies: TextByteAnomaly[] = [];
  const { bytes, textAttr, eolAttr } = input;

  // Detect NUL byte (binary indicator)
  const hasNul = bytes.indexOf(0) >= 0;
  if (hasNul) anomalies.push('nul-byte');

  // Detect UTF-8 BOM
  const hasBom = bytes.length >= 3
    && bytes[0] === UTF8_BOM[0]
    && bytes[1] === UTF8_BOM[1]
    && bytes[2] === UTF8_BOM[2];
  if (hasBom) anomalies.push('utf8-bom');

  // Detect line endings
  let hasLf = false;
  let hasCrlf = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0A) {
      if (i > 0 && bytes[i - 1] === 0x0D) {
        hasCrlf = true;
      } else {
        hasLf = true;
      }
    }
  }
  const lineEnding: TextByteLineEnding = hasCrlf && hasLf
    ? 'mixed'
    : hasCrlf ? 'crlf'
    : hasLf ? 'lf'
    : 'none';

  // Line-ending anomalies only apply to text blobs, not binary
  if (lineEnding === 'mixed' && textAttr !== 'unset') anomalies.push('mixed-endings');

  // Detect unknown encoding (not valid UTF-8, not declared binary)
  let unknownEncoding = false;
  if (textAttr !== 'unset' && !hasNul) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      unknownEncoding = true;
      anomalies.push('unknown-encoding');
    }
  }

  // Classify only from Git's resolution of the committed .gitattributes
  // policy. File-extension copies here would create a competing authority.
  let classification: TextByteClassification;
  if (textAttr === 'unsupported' || eolAttr === 'unsupported'
      || (textAttr === 'unspecified' && eolAttr !== 'unspecified')) {
    anomalies.push('attributes-unsupported');
    classification = 'unknown';
  } else if (textAttr === 'unset') {
    classification = 'binary';
  } else if (textAttr === 'set' && eolAttr === 'lf') {
    classification = 'canonical-lf';
    if (hasCrlf) anomalies.push('crlf-in-canonical-lf-blob');
  } else if (textAttr === 'set' && eolAttr === 'crlf') {
    classification = 'explicit-crlf';
    if (hasLf) anomalies.push('lf-in-explicit-crlf-blob');
  } else if (textAttr === 'set' && eolAttr === 'unspecified') {
    // text without explicit eol; treat as canonical-lf by default
    classification = 'canonical-lf';
    if (hasCrlf) anomalies.push('crlf-in-canonical-lf-blob');
  } else {
    classification = 'preserve-external';
  }

  // NUL is a terminal text-policy violation even though it is valid UTF-8.
  if ((unknownEncoding || hasNul) && classification !== 'binary') {
    classification = 'unknown';
  }

  return { classification, lineEnding, anomalies };
}

/**
 * Create empty classification and anomaly count tables for census aggregation.
 */
export function createEmptyCensusReport(): {
  classificationCounts: Record<TextByteClassification, number>;
  anomalyCounts: Record<TextByteAnomaly, number>;
} {
  return {
    classificationCounts: {
      'canonical-lf': 0,
      'explicit-crlf': 0,
      'binary': 0,
      'preserve-external': 0,
      'unknown': 0
    },
    anomalyCounts: {
      'crlf-in-canonical-lf-blob': 0,
      'lf-in-explicit-crlf-blob': 0,
      'mixed-endings': 0,
      'utf8-bom': 0,
      'nul-byte': 0,
      'unknown-encoding': 0,
      'attributes-unsupported': 0
    }
  };
}
