import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitProtocolSuccess, inGitProtocolRepository } from '../../testkit/git-protocol.ts';

import { expect, test } from 'bun:test';
import { observeOperationAuthorityOwners } from '../../../src/adapters/self-hosting/control/agent/agent-operation-activation.ts';
import { assertWorkerOperationReadPlanMatches, projectWorkerOperationReadClosure } from '../../../src/adapters/self-hosting/control/agent/operation-read-plan.ts';
import { projectWorkerTaskCapsuleObservation } from '../../../src/adapters/self-hosting/control/agent/task-capsule-host.ts';
import { parseDocumentationIdentityRegistry } from '../../../src/adapters/self-hosting/control/documentation/active.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest } from '../../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../../src/assurance/verification/contract/revision.ts';
import { rawSha256 } from '../../../src/contracts/canonical.ts';


import {
  compileOperationReadPlan,
  OPERATION_READ_PLAN_INPUT_SCHEMA
} from '../../../src/adapters/self-hosting/control/agent/read-plan.ts';
import { type AgentContentDigest } from '../../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
const digest = (character: string): AgentContentDigest => `sha256:${character.repeat(64)}`;

test.skipIf(process.platform !== 'linux')('FINAL successor rule-loading owner stays trusted through real observation, Capsule and Read Plan comparison', async () => {
  const guidance = 'docs/开发/AI协作/规则装载与任务恢复.md';
  const manifestPath = 'config/repository/work-packages/final-successor-fixture.md';
  const manifestBytes = Buffer.from(`---
schema: codex-development-work-package-v3
id: final-successor-fixture
tracking: none
manifestState: frozen
requiredProfile: quick
ciRevision: ${CI_VERIFICATION_CONTRACT_REVISION}
tasks:
  - id: update-rule-loading
    owner: development-governance
    ownedPaths:
      - "${guidance}"
forbiddenPaths:
  - "AGENTS.md"
acceptance:
  - "Keep FINAL rule-loading authority bound to the trusted revision."
tests:
  - "tests/contract/development/skill-applicability.test.ts"
---
`);
  const baseManifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestBytes.toString('utf8'), manifestPath);
  expect(baseManifest.tasks.some(task => task.ownedPaths.includes(guidance))).toBe(true);
  expect(baseManifest.forbiddenPaths).toContain('AGENTS.md');
  const registryPath = '.documentation/documents.json';
  const registryBytes = readFileSync(path.join(REPOSITORY_ROOT, registryPath));
  const registry = parseDocumentationIdentityRegistry(registryBytes.toString('utf8'));
  const manifest = { ...baseManifest, authorityRefs: [registry.documents.find(record => record.path === guidance)!.documentId] };
  const observedPaths = [...new Set(['AGENTS.md', guidance, ...registry.documents
    .filter(record => manifest.authorityRefs?.includes(record.documentId)).map(record => record.path)])];
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, '.documentation'), { recursive: true });
    writeFileSync(path.join(root, registryPath), registryBytes);
    for (const repositoryPath of observedPaths) {
      mkdirSync(path.dirname(path.join(root, repositoryPath)), { recursive: true });
      writeFileSync(path.join(root, repositoryPath), `trusted ${repositoryPath}\n`);
    }
    gitProtocolSuccess(git(['add', '--', registryPath, ...observedPaths]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'trusted registered owner fixtures']));
    const trustedRevision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    writeFileSync(path.join(root, guidance), 'candidate replacement guidance\n');
    gitProtocolSuccess(git(['add', '--', guidance]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'FINAL rule-loading fixture']));
    const targetCandidate = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    // Current published package is not activation-ready: preserve its missing-authorityRefs refusal.
    await expect(observeOperationAuthorityOwners(root, trustedRevision, targetCandidate, baseManifest, [guidance]))
      .rejects.toThrow('activation-scope-conflict');
    // This successor fixture supplies the required registry-bound refs, without
    // claiming a hosted activation receipt or current-main package adoption.
    const authorityOwners = await observeOperationAuthorityOwners(root, trustedRevision, targetCandidate, manifest, [guidance]);
    const trustedBlob = gitProtocolSuccess(git(['rev-parse', `${trustedRevision}:${guidance}`])).trim();
    const candidateBlob = gitProtocolSuccess(git(['rev-parse', `${targetCandidate}:${guidance}`])).trim();
    const owner = authorityOwners.find(entry => entry.ref === guidance)!;
    expect(owner.revision).toBe(trustedBlob);
    expect(owner.contentDigest).toBe(rawSha256(`trusted ${guidance}\n`));
    const activation = {
      phase: 'finalize' as const, manifest, manifestPath,
      manifestRevision: digest('1'), manifestDigest: rawSha256(manifestBytes),
      authorityOwners, activationDigest: digest('2'), targetCandidate, trustedRevision,
      changedPaths: [guidance], runtimeRoot: root, candidateRoot: root,
      preparation: {
        operationId: 'fixture-final-operation', role: 'worker' as const, operationKind: 'implement' as const,
        currentSpecRevision: digest('3'), trustedBaseSha: trustedRevision,
        proposal: { number: 1, baseSha: trustedRevision, headSha: trustedRevision,
          headTreeSha: gitProtocolSuccess(git(['rev-parse', `${trustedRevision}^{tree}`])).trim(),
          headRef: 'fixture', manifestPath, manifestDigest: rawSha256(manifestBytes) },
        controlDigests: { currentState: digest('4'), pointer: digest('5'), rollingPlan: digest('6') }
      }
    };
    // Only resolved-input projection is under test. This fixture neither
    // authenticates a hosted receipt nor grants an operation to an agent.
    const observation = projectWorkerOperationReadClosure(projectWorkerTaskCapsuleObservation(activation));
    expect(observation.taskCapsule.planningContext.ownerFacts.find(fact => fact.ref === guidance)?.revision)
      .toBe(trustedBlob);
    expect(observation.readClosure.requiredRefs.find(ref => ref.ref === guidance)?.revision).toBe(trustedBlob);
    expect(observation.readClosure.readReceipts.find(receipt => receipt.refId === owner.id)?.contentDigest)
      .toBe(rawSha256(`trusted ${guidance}\n`));
    const plan = compileOperationReadPlan({ ...observation.readClosure,
      schema: OPERATION_READ_PLAN_INPUT_SCHEMA, taskCapsule: observation.taskCapsule });
    expect(() => assertWorkerOperationReadPlanMatches(plan, observation)).not.toThrow();
    const candidateBound = projectWorkerOperationReadClosure(projectWorkerTaskCapsuleObservation({
      ...activation,
      authorityOwners: authorityOwners.map(entry => entry.ref === guidance
        ? { ...entry, revision: candidateBlob, contentDigest: rawSha256('candidate replacement guidance\n') }
        : entry)
    }));
    const forgedPlan = compileOperationReadPlan({ ...candidateBound.readClosure,
      schema: OPERATION_READ_PLAN_INPUT_SCHEMA, taskCapsule: candidateBound.taskCapsule });
    expect(() => assertWorkerOperationReadPlanMatches(forgedPlan, observation))
      .toThrow('Read Plan was not fully produced by the exact trusted-resolver');
  });
});
