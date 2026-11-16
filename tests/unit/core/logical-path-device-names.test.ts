import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isCanonicalCiArtifactPath } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { isWindowsReservedLogicalComponent } from '../../../src/contracts/logical-path-component.ts';
import { isCanonicalPortableLogicalPath } from '../../../src/contracts/logical-path.ts';

test('ordinary and superscript Windows device stems stay forbidden', () => {
  // Preserve each stem/digit pair; casing and extensions share the same owner rule.
  for (const component of ['COM¹', 'com².txt', 'COM³.tar.gz', 'lpt¹', 'LPT².tar.gz', 'lpt³.txt']) {
    assert.equal(isWindowsReservedLogicalComponent(component), true, component);
  }
  assert.equal(isCanonicalPortableLogicalPath('nested/COM¹.txt'), false);
  assert.equal(isCanonicalCiArtifactPath('.sec/artifacts/COM¹.txt'), false);
  // Ordinary names are another input class of the same reserved-name guard.
  for (const value of ['CON', 'prn', 'Aux', 'NUL.txt', 'com1', 'Com9.log', 'Lpt1', 'lpt9.tar.gz']) {
    assert.equal(isWindowsReservedLogicalComponent(value), true, value);
  }
});

test('device-looking ordinary names are not rejected by a prefix-only heuristic', () => {
  for (const value of ['com0', 'com10', 'com1x', 'lpt0', 'lpt10', 'xCOM¹', 'COM¹x', 'COM⁴', 'lpt⁹', '..cache', 'auxiliary', '文件.ts']) {
    assert.equal(isWindowsReservedLogicalComponent(value), false, value);
  }
  assert.equal(isCanonicalPortableLogicalPath('nested/COM¹x'), true);
  assert.equal(isCanonicalPortableLogicalPath('nested/..cache'), true);
});
