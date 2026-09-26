import { expect, test } from 'bun:test';

import {
  decodeRepositoryAuditFullReport,
  encodeRepositoryAuditFullReport
} from './full-report-transport.ts';

test('full report transport round-trips lone UTF-16 surrogates and reserved-prefix strings', () => {
  const source = {
    plain: 'ok',
    loneHigh: '\uD800',
    loneLow: '\uDFFF',
    pair: '\uD83D\uDE00',
    reserved: '~sec:utf16:v1:utf16le:not-an-escape',
    nested: [{ ['key\uD800']: 'value\uDFFF' }]
  };
  const envelope = encodeRepositoryAuditFullReport(source);
  const json = JSON.stringify(envelope);
  expect(json.includes('\\ud800')).toBe(false);
  expect(json.includes('\\udfff')).toBe(false);
  const decoded = decodeRepositoryAuditFullReport(JSON.parse(json));
  expect(decoded).toEqual(source);
});

test('full report transport rejects unknown escape forms instead of guessing', () => {
  expect(() => decodeRepositoryAuditFullReport({
    schema: 'repository-audit-full-report-v1',
    stringEncoding: 'sec-utf16-reversible-v1',
    report: '~sec:utf16:v1:future:abc'
  })).toThrow(/unknown UTF-16 transport escape/u);
});
