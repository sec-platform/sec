import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isWindowsReservedLogicalComponent } from '../../src/contracts/logical-path-component.ts';
import { isCanonicalPortableLogicalPath } from '../../src/contracts/logical-path.ts';
import { isCanonicalCiArtifactPath } from '../../src/verification/ci-artifacts/contract/manifest.ts';

test('Win32 COM/LPT superscript device aliases and their extensions are rejected', () => {
  for (const stem of ['COM', 'LPT', 'com', 'lpt']) {
    for (const digit of ['¹', '²', '³']) {
      for (const suffix of ['', '.txt', '.tar.gz']) {
        const component = `${stem}${digit}${suffix}`;
        assert.equal(isWindowsReservedLogicalComponent(component), true, component);
        assert.equal(isCanonicalPortableLogicalPath(`nested/${component}`), false, component);
        assert.equal(isCanonicalCiArtifactPath(`.sec/artifacts/${component}`), false, component);
      }
    }
  }
});

test('ordinary reserved device stems remain rejected with mixed case and extensions', () => {
  for (const value of ['CON', 'prn', 'Aux', 'NUL.txt', 'com1', 'Com9.log', 'Lpt1', 'lpt9.tar.gz']) {
    assert.equal(isWindowsReservedLogicalComponent(value), true, value);
    assert.equal(isCanonicalPortableLogicalPath(value), false, value);
  }
});

test('device-looking ordinary names are not rejected by a prefix-only heuristic', () => {
  for (const value of ['com0', 'com10', 'com1x', 'lpt0', 'lpt10', 'xCOM¹', 'COM¹x', 'COM⁴', 'lpt⁹', '..cache', 'auxiliary', '文件.ts']) {
    assert.equal(isWindowsReservedLogicalComponent(value), false, value);
    assert.equal(isCanonicalPortableLogicalPath(`nested/${value}`), true, value);
  }
});

test('portable path traversal, stream and normalization guards remain independent of device names', () => {
  for (const value of ['', '.', '..', 'a/../b', 'a//b', 'file:stream', 'nul ', 'trailing.', 'e\u0301.ts', 'a\\b', '/absolute']) {
    assert.equal(isCanonicalPortableLogicalPath(value), false, value);
  }
  assert.equal(isCanonicalPortableLogicalPath('é.ts'), true);
});
