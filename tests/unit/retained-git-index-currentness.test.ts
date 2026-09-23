import { expect, test } from 'bun:test';
import { runRetainedGitWriteTreeProbeV1 } from '../helpers/retained-git-write-tree-probe.ts';

// The warm-index success case lives in physical-no-follow.test.ts. A native
// writer is not made read-only by its command name or optional-lock setting.
test.skipIf(process.platform !== 'linux')('cold write-tree mutation cannot pass the retained-index currentness fence', () => {
  let rejection: unknown;
  try { runRetainedGitWriteTreeProbeV1(false); }
  catch (error) { rejection = error; }
  expect(rejection).toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' });
});
