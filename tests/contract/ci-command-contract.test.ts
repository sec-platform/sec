import { expect, test } from 'bun:test';

import { buildCiContract } from '../../src/adapters/verification/platform/ci/contract/core.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CI contract retains stable gate commands and artifact boundaries', () => {
  const contract = buildCiContract();
  const steps = new Map(contract.steps.map((step) => [step.id, step]));

  expect(contract).toMatchObject({
    status: 'active',
    command: 'bun run sec -- contract ci --json',
    defaultGate: 'fast-runtime-verify',
    fullRuntimeGate: 'full-runtime-verify'
  });
  expect(steps.get('fast-runtime-verify')).toMatchObject({
    phase: 'verify',
    command: 'bun run sec -- verify --json --compact',
    produces: ['.sec/artifacts/evidence/verification-report.json']
  });
  expect(steps.get('full-runtime-verify')).toMatchObject({
    phase: 'verify',
    command: 'bun run sec -- verify --lane all --json --compact',
    produces: expect.arrayContaining([
      '.sec/artifacts/evidence/verification-report.json',
      '.sec/artifacts/evidence/runtime-report.json',
      '.sec/artifacts/evidence/acceptance-coverage.json'
    ])
  });
  expect(steps.get('reference-drift')).toMatchObject({
    phase: 'quality',
    command: 'bun run sec -- reference check --json --compact'
  });
  expect(steps.get('contract-artifacts')).toMatchObject({
    phase: 'artifacts',
    command: 'bun run sec -- artifacts --paths --json --compact --kind contract',
    produces: ['.sec/artifacts/ci/artifacts.json']
  });
});

test('CI-contract CLI exposes the stable public boundary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'ci'], {
      text: [
        'CI contract active',
        'Command: bun run sec -- contract ci --json',
        'Default gate: fast-runtime-verify',
        'Full runtime gate: full-runtime-verify',
        'Step reference-drift; phase=quality; command=bun run sec -- reference check --json --compact',
        'Step contract-artifacts; phase=artifacts; command=bun run sec -- artifacts --paths --json --compact --kind contract'
      ],
      json: {
        status: 'active',
        command: 'bun run sec -- contract ci --json',
        defaultGate: 'fast-runtime-verify',
        fullRuntimeGate: 'full-runtime-verify'
      }
    });
  });
});
