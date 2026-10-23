import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TemplateEngine } from '../../../src/adapters/compilation/compose/template-engine.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

test('template file reads stay inside the root and observe current bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-template-engine-'));
  try {
    const templatePath = path.join(root, 'sample.template');
    writeFileSync(templatePath, 'first __value__', 'utf8');
    expect(TemplateEngine.render('sample.template', { value: 1 }, root)).toBe('first 1');

    writeFileSync(templatePath, 'second __value__', 'utf8');
    expect(TemplateEngine.render('sample.template', { value: 2 }, root)).toBe('second 2');

    assert.throws(() => TemplateEngine.render('../outside.template', {}, root), (error: unknown) => error instanceof CodedFailure && error.code === 'COMPOSE-TEMPLATE-005');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
