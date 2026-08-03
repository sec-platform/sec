import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse } from 'yaml';

const ROOT = path.resolve(import.meta.dir, '../..');
const WORKFLOW = path.join(ROOT, '.github/workflows/compiler-release-validation.yml');

type WorkflowStep = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

async function releaseSteps(): Promise<WorkflowStep[]> {
  const source = (await readFile(WORKFLOW, 'utf8')).replaceAll('\r\n', '\n');
  const document = parse(source) as {
    jobs?: Record<string, { steps?: WorkflowStep[] }>;
  };
  const steps = document.jobs?.['compiler-release-verification']?.steps;
  if (!Array.isArray(steps)) throw new Error('Release verification workflow steps are missing.');
  return steps;
}

function checkoutSteps(steps: readonly WorkflowStep[]): Array<{ step: WorkflowStep; index: number }> {
  return steps.flatMap((step, index) =>
    typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')
      ? [{ step, index }]
      : []
  );
}

function verificationRunSteps(steps: readonly WorkflowStep[]): Array<{ step: WorkflowStep; index: number }> {
  return steps.flatMap((step, index) =>
    typeof step.run === 'string' && step.run.includes('scripts/ci-verification.ts')
      ? [{ step, index }]
      : []
  );
}

test('release verification requires exactly one parent', async () => {
  const steps = await releaseSteps();
  const resolver = steps.find((step) => step.id === 'verification');
  const script = resolver?.with?.script;

  expect(typeof script).toBe('string');
  expect(script).toContain('if (commit.parents.length !== 1)');
  expect(script).toContain("throw new Error('Release verification requires one exact single-parent candidate.');");
  expect(script).toContain("core.setOutput('base', commit.parents[0].sha);");
});

test('release verification has one exact credential-free checkout', async () => {
  const steps = await releaseSteps();
  const checkouts = checkoutSteps(steps);

  expect(checkouts).toHaveLength(1);
  const inputs = checkouts[0]!.step.with ?? {};
  expect(Object.keys(inputs).sort()).toEqual(['fetch-depth', 'persist-credentials', 'ref']);
  expect(inputs.ref).toBe('${{ steps.verification.outputs.sha }}');
  expect(inputs['fetch-depth']).toBe(2);
  expect(inputs['persist-credentials']).toBe(false);
});

test('release verification contains no raw fetch or injected credential input', async () => {
  const steps = await releaseSteps();

  for (const step of steps) {
    if (typeof step.run === 'string') {
      expect(step.run).not.toMatch(/(?:^|[;&|\n]\s*)git\s+fetch\b/u);
      expect(step.run).not.toMatch(/(?:GH_TOKEN|GITHUB_TOKEN|http\.extraheader|credential\.helper)/u);
    }
    if (typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')) {
      const keys = Object.keys(step.with ?? {});
      expect(keys).not.toContain('token');
      expect(keys).not.toContain('ssh-key');
      expect(keys).not.toContain('ssh-known-hosts');
    }
  }
});

test('the resolved first parent remains the sole changed-files and affected-tests base', async () => {
  const steps = await releaseSteps();
  const verification = verificationRunSteps(steps);

  expect(verification).toHaveLength(1);
  const step = verification[0]!.step;
  const env = (step as WorkflowStep & { env?: Record<string, unknown> }).env ?? {};
  expect(env.SEC_CHANGED_BASE).toBe('${{ steps.verification.outputs.base }}');
  expect(env.SEC_AFFECTED_TESTS_BASE).toBe('${{ steps.verification.outputs.base }}');
  expect(env.SEC_EXPECTED_HEAD_SHA).toBe('${{ steps.verification.outputs.sha }}');
  expect(step.run).toContain('bun scripts/ci-verification.ts --profile full --expected-head "$SEC_EXPECTED_HEAD_SHA"');
});

test('resolver and trust-root comparison precede every checkout and verification run', async () => {
  const steps = await releaseSteps();
  const resolverIndex = steps.findIndex((step) => step.id === 'verification');
  const resolverScript = steps[resolverIndex]?.with?.script;

  expect(resolverIndex).toBeGreaterThanOrEqual(0);
  expect(typeof resolverScript).toBe('string');
  expect(resolverScript).toContain('manual-bootstrap-required: release ref changes the verifier trust root.');

  for (const { index } of [...checkoutSteps(steps), ...verificationRunSteps(steps)]) {
    expect(index).toBeGreaterThan(resolverIndex);
  }
});
