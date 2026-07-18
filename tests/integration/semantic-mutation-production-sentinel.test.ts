import { test } from 'bun:test';

const enabled = process.env.SEC_RUN_SM3_PRODUCTION_SENTINEL === '1';

test.skipIf(!enabled)(
  'isolated production bundle resolves through plan-bound staging dependencies',
  async () => {
    const { runSemanticMutationProductionSentinel } =
      await import('../helpers/semantic-mutation-production-sentinel.ts');
    await runSemanticMutationProductionSentinel();
  }
);
