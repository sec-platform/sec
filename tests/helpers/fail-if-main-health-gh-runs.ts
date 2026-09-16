import { appendFileSync } from 'node:fs';

const sentinelPath = process.env.SEC_TEST_GH_EXECUTION_SENTINEL;
if (!sentinelPath) {
  throw new Error('SEC_TEST_GH_EXECUTION_SENTINEL is required');
}

appendFileSync(sentinelPath, 'spawned\n', 'utf8');
process.stdout.write('test-token-0123456789');
