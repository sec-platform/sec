import { expect, test } from 'bun:test';

import { UTF8_BOM, classifyBlobBytes } from '../../src/runtime-state/text-byte-census.ts';

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

test('unmatched files preserve bytes because committed Git attributes are the sole policy authority', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('content\n'),
    textAttr: 'unspecified',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('preserve-external');
  expect(result.anomalies).toEqual([]);
});

test('unsupported committed Git attribute values fail closed', () => {
  const result = classifyBlobBytes({
    path: 'src/file.ts',
    bytes: toBytes('content\n'),
    textAttr: 'unsupported',
    eolAttr: 'unspecified'
  });
  expect(result.classification).toBe('unknown');
  expect(result.anomalies).toEqual(['attributes-unsupported']);
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
  expect(result.classification).toBe('unknown');
  expect(result.anomalies).toContain('nul-byte');
});

test('explicit CRLF rejects both pure LF and mixed line endings', () => {
  for (const [source, lineEnding, anomalies] of [
    ['line1\nline2\n', 'lf', ['lf-in-explicit-crlf-blob']],
    [
      'line1\r\nline2\n',
      'mixed',
      ['mixed-endings', 'lf-in-explicit-crlf-blob']
    ]
  ] as const) {
    const result = classifyBlobBytes({
      path: 'windows.cmd',
      bytes: toBytes(source),
      textAttr: 'set',
      eolAttr: 'crlf'
    });
    expect(result.classification).toBe('explicit-crlf');
    expect(result.lineEnding).toBe(lineEnding);
    expect(result.anomalies).toEqual([...anomalies]);
  }
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
