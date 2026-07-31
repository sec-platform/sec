import { expect, test } from 'bun:test';

import {
  BINARY_EXTENSIONS,
  GOVERNED_TEXT_EXTENSIONS,
  TEXT_BYTE_CENSUS_SCHEMA_V1,
  UTF8_BOM,
  classifyBlobBytes,
  createEmptyCensusReport,
  type TextByteAnomaly,
  type TextByteClassification
} from '../../platform/shared/text-byte-census-contract.ts';

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test('classifyBlobBytes classifies canonical-lf blob with text eol=lf', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('line1\nline2\n'),
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.classification).toBe('canonical-lf');
  expect(result.lineEnding).toBe('lf');
  expect(result.anomalies).toEqual([]);
});

test('classifyBlobBytes classifies explicit-crlf blob with text eol=crlf', () => {
  const result = classifyBlobBytes({
    path: 'windows.bat',
    bytes: toBytes('line1\r\nline2\r\n'),
    textAttr: 'set',
    eolAttr: 'crlf'
  });
  expect(result.classification).toBe('explicit-crlf');
  expect(result.lineEnding).toBe('crlf');
  expect(result.anomalies).toEqual([]);
});

test('classifyBlobBytes classifies binary blob with -text attribute', () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = classifyBlobBytes({
    path: 'image.png',
    bytes,
    textAttr: 'unset',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('binary');
  expect(result.anomalies).toEqual([]);
});

test('classifyBlobBytes classifies preserve-external for ungoverned extension', () => {
  const result = classifyBlobBytes({
    path: 'data.unknownext',
    bytes: toBytes('some content\n'),
    textAttr: 'unspecified',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('preserve-external');
  expect(result.anomalies).toEqual([]);
});

test('classifyBlobBytes classifies unknown with attributes-missing for governed extension', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('content\n'),
    textAttr: 'unspecified',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('unknown');
  expect(result.anomalies).toContain('attributes-missing');
});

test('classifyBlobBytes classifies unknown with attributes-missing for binary extension', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const result = classifyBlobBytes({
    path: 'photo.jpg',
    bytes,
    textAttr: 'unspecified',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('unknown');
  expect(result.anomalies).toContain('attributes-missing');
});

test('classifyBlobBytes detects crlf-in-canonical-lf-blob anomaly', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('line1\r\nline2\n'),
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.classification).toBe('canonical-lf');
  expect(result.lineEnding).toBe('mixed');
  expect(result.anomalies).toContain('crlf-in-canonical-lf-blob');
  expect(result.anomalies).toContain('mixed-endings');
});

test('classifyBlobBytes detects mixed-endings anomaly', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('line1\r\nline2\nline3\r\n'),
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.lineEnding).toBe('mixed');
  expect(result.anomalies).toContain('mixed-endings');
});

test('classifyBlobBytes detects utf8-bom anomaly', () => {
  const bomBytes = new Uint8Array([...UTF8_BOM, ...toBytes('content\n')]);
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: bomBytes,
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.classification).toBe('canonical-lf');
  expect(result.anomalies).toContain('utf8-bom');
});

test('classifyBlobBytes detects nul-byte anomaly', () => {
  const bytes = new Uint8Array([0x61, 0x00, 0x62, 0x0a]);
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes,
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.anomalies).toContain('nul-byte');
});

test('classifyBlobBytes detects unknown-encoding anomaly and classifies unknown', () => {
  // Invalid UTF-8 sequence
  const bytes = new Uint8Array([0x80, 0x81, 0x0a]);
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes,
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.classification).toBe('unknown');
  expect(result.anomalies).toContain('unknown-encoding');
});

test('classifyBlobBytes does not report unknown-encoding for binary blobs', () => {
  const bytes = new Uint8Array([0x80, 0x81, 0x00, 0x0a]);
  const result = classifyBlobBytes({
    path: 'image.png',
    bytes,
    textAttr: 'unset',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('binary');
  expect(result.anomalies).not.toContain('unknown-encoding');
});

test('classifyBlobBytes treats text without explicit eol as canonical-lf', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('content\n'),
    textAttr: 'set',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('canonical-lf');
});

test('classifyBlobBytes handles blob with no line endings', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('oneliner'),
    textAttr: 'set',
    eolAttr: 'lf'
  });
  expect(result.lineEnding).toBe('none');
  expect(result.classification).toBe('canonical-lf');
  expect(result.anomalies).toEqual([]);
});

test('createEmptyCensusReport returns zero counts for all classifications', () => {
  const report = createEmptyCensusReport();
  const classifications: TextByteClassification[] = ['canonical-lf', 'explicit-crlf', 'binary', 'preserve-external', 'unknown'];
  for (const c of classifications) {
    expect(report.classificationCounts[c]).toBe(0);
  }
});

test('createEmptyCensusReport returns zero counts for all anomalies', () => {
  const report = createEmptyCensusReport();
  const anomalies: TextByteAnomaly[] = [
    'crlf-in-canonical-lf-blob',
    'lf-in-explicit-crlf-blob',
    'mixed-endings',
    'utf8-bom',
    'nul-byte',
    'unknown-encoding',
    'attributes-missing',
    'attributes-conflict'
  ];
  for (const a of anomalies) {
    expect(report.anomalyCounts[a]).toBe(0);
  }
});

test('TEXT_BYTE_CENSUS_SCHEMA_V1 is stable', () => {
  expect(TEXT_BYTE_CENSUS_SCHEMA_V1).toBe('sec-text-byte-census-v1');
});

test('GOVERNED_TEXT_EXTENSIONS covers core source extensions', () => {
  expect(GOVERNED_TEXT_EXTENSIONS.has('ts')).toBe(true);
  expect(GOVERNED_TEXT_EXTENSIONS.has('js')).toBe(true);
  expect(GOVERNED_TEXT_EXTENSIONS.has('json')).toBe(true);
  expect(GOVERNED_TEXT_EXTENSIONS.has('yaml')).toBe(true);
  expect(GOVERNED_TEXT_EXTENSIONS.has('md')).toBe(true);
});

test('BINARY_EXTENSIONS covers core binary extensions', () => {
  expect(BINARY_EXTENSIONS.has('png')).toBe(true);
  expect(BINARY_EXTENSIONS.has('jpg')).toBe(true);
  expect(BINARY_EXTENSIONS.has('zip')).toBe(true);
  expect(BINARY_EXTENSIONS.has('woff2')).toBe(true);
});
