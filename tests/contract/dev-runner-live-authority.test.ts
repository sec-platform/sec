import { describe, expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import {
  analyzeDevRunnerAuthorityProof,
  createDevRunnerLiveAuthorityScenarioV1
} from '../helpers/dev-runner-authority-proof.ts';

describe('dev-runner live authority', () => {
  test('the exact tracked host closes its bounded authority contracts', async () => {
    const packageJson = JSON.parse(await readCompilerFile('package.json')) as unknown;
    const suite = await analyzeDevRunnerAuthorityProof([
      createDevRunnerLiveAuthorityScenarioV1(packageJson)
    ]);
    expect(suite.scenarioIds).toEqual(['live']);
    expect(suite.scenarioProofs).toHaveLength(1);
    expect(suite.scenarioProofs[0]).toMatchObject({
      scenarioId: 'live',
      violations: [],
      violationCodes: []
    });
  });
});
