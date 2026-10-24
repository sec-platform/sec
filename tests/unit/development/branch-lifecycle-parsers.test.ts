import { expect, test } from 'bun:test';

import {
  parseLocalBranchRefs,
  parseRemoteHeadRefs
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-parsers.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const SHA_D = 'd'.repeat(40);

test('branch ref parsers preserve exact branch-to-SHA bindings in code-unit order', () => {
  // Git's byte-sorted refnames can differ from the admitted code-unit order.
  // U+E000 precedes U+10000 in UTF-8, but follows it in UTF-16 code units.
  const local = parseLocalBranchRefs(
    `Z-branch\0${SHA_B}\0\na-branch\0${SHA_A}\0\n\uE000-branch\0${SHA_C}\0\n\u{10000}-branch\0${SHA_D}\0\n`
  );
  expect(local).toEqual([
    { branch: 'Z-branch', sha: SHA_B },
    { branch: 'a-branch', sha: SHA_A },
    { branch: '\u{10000}-branch', sha: SHA_D },
    { branch: '\uE000-branch', sha: SHA_C }
  ]);

  const remote = parseRemoteHeadRefs(
    `${SHA_B} refs/heads/Z-branch\n${SHA_A} refs/heads/a-branch\n${SHA_C} refs/heads/\uE000-branch\n${SHA_D} refs/heads/\u{10000}-branch\n`
  );
  expect(remote).toEqual([
    { branch: 'Z-branch', sha: SHA_B },
    { branch: 'a-branch', sha: SHA_A },
    { branch: '\u{10000}-branch', sha: SHA_D },
    { branch: '\uE000-branch', sha: SHA_C }
  ]);
});
