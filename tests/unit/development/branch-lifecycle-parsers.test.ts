import { expect, test } from 'bun:test';

import {
  parseLocalBranchRefs,
  parseRemoteHeadRefs
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-parsers.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('branch ref parsers preserve exact branch-to-SHA bindings in code-unit order', () => {
  const local = parseLocalBranchRefs(
    `a-branch\0${SHA_A}\0\nZ-branch\0${SHA_B}\0\n`
  );
  expect(local).toEqual([
    { branch: 'Z-branch', sha: SHA_B },
    { branch: 'a-branch', sha: SHA_A }
  ]);

  const remote = parseRemoteHeadRefs(
    `${SHA_A} refs/heads/a-branch\n${SHA_B} refs/heads/Z-branch\n`
  );
  expect(remote).toEqual([
    { branch: 'Z-branch', sha: SHA_B },
    { branch: 'a-branch', sha: SHA_A }
  ]);
});
