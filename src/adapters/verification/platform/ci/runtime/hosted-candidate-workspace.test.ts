import { describe, expect, test } from 'bun:test';

import { ResourceCompositeSettlementError } from '../../../../../execution/resource-settlement.ts';
import type { AuthenticatedGitHubJobOrigin } from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  assertHostedCandidateWorkspaceMutationObservation, assertHostedCandidateWorkspacePurpose, assertHostedCandidateWorkspaceTreeInventory,
  captureHostedCandidateWorkspaceSubject, HostedCandidateWorkspaceCleanupUnknownError, withHostedCandidateWorkspace,
  type HostedCandidateWorkspacePurpose
} from './hosted-candidate-workspace.ts';

const subject = Object.freeze({ baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40),
  headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40) });
const phases = [
  ['activation-static', 'compiler-pr-validation', 'agent-operation-activation', 'produce-hosted'],
  ['action-materialization', 'compiler-pr-validation', 'claim-verification-action', 'prepare-start-marker'],
  ['bootstrap-checker', 'trusted-bootstrap', 'checker-pre', 'checker-pre'],
  ['bootstrap-checker', 'trusted-bootstrap', 'checker-post', 'checker-post'],
  ['bootstrap-materialization', 'trusted-bootstrap', 'candidate-sut', 'execute-trusted-bootstrap-sut']
] as const;

describe('hosted candidate data workspace closed contract', () => {
  test('snapshots every exact subject selector and refuses shorthand or noncanonical objects', () => {
    const input = { ...subject };
    const captured = captureHostedCandidateWorkspaceSubject(input);
    input.headSha = '9'.repeat(40);
    expect(captured).toEqual(subject);
    expect(Object.isFrozen(captured)).toBe(true);
    for (const key of Object.keys(subject)) {
      for (const value of ['main', 'A'.repeat(40), '1'.repeat(64), '', undefined]) {
        expect(() => captureHostedCandidateWorkspaceSubject({ ...subject, [key]: value })).toThrow();
      }
    }
  });

  test('each purpose binds the exact workflow, job and actual phase', () => {
    for (const [purpose, workflow, job, phase] of phases) {
      const observed = { workflowPath: `.github/workflows/${workflow}.yml`, policyJobId: job, phase };
      expect(() => assertHostedCandidateWorkspacePurpose(purpose, observed)).not.toThrow();
      for (const key of ['workflowPath', 'policyJobId', 'phase']) {
        expect(() => assertHostedCandidateWorkspacePurpose(purpose, { ...observed, [key]: 'foreign' })).toThrow();
      }
      for (const other of ['execute-hosted-action-sut', 'integrate-hosted', 'publish-hosted']) {
        expect(() => assertHostedCandidateWorkspacePurpose(purpose, { ...observed, phase: other })).toThrow();
      }
    }
    expect(() => assertHostedCandidateWorkspacePurpose('foreign' as HostedCandidateWorkspacePurpose,
      { workflowPath: '.github/workflows/trusted-bootstrap.yml', policyJobId: 'candidate-sut', phase: 'execute-trusted-bootstrap-sut' })).toThrow();
  });

  test('reserved input and refs are allowed only for exact candidate materialization purposes', () => {
    const observation = { checkout: 'candidate' as const, subject,
      status: '?? .sec-trusted-input/candidate.bundle\0?? .sec-trusted-input/dependency-closure.json\0',
      refs: `refs/sec/base ${subject.baseSha}\nrefs/sec/head ${subject.headSha}\n` };
    for (const purpose of ['action-materialization', 'bootstrap-materialization'] as const) {
      expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, purpose })).not.toThrow();
      for (const status of [' M src/file.ts\0', '?? .sec-trusted-input/foreign\0', '?? node_modules/file\0',
        '?? foreign\0', '?? .sec-trusted-input/candidate.bundle']) {
        expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, purpose, status })).toThrow();
      }
      for (const refs of [`refs/sec/base ${subject.headSha}\n`, `refs/replace/${subject.headSha} ${subject.baseSha}\n`,
        `refs/sec/head ${subject.headSha}`, observation.refs + observation.refs]) {
        expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, purpose, refs })).toThrow();
      }
    }
    for (const purpose of ['activation-static', 'bootstrap-checker'] as const) {
      expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, purpose })).toThrow();
      expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, purpose, status: '', refs: '' })).not.toThrow();
    }
  });

  test('only the private bootstrap base may receive the original base dependency installation', () => {
    const observation = { checkout: 'base' as const, purpose: 'bootstrap-materialization' as const,
      subject, status: '!! node_modules/\0', refs: '' };
    expect(() => assertHostedCandidateWorkspaceMutationObservation(observation)).not.toThrow();
    expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, checkout: 'candidate' })).toThrow();
    expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, purpose: 'bootstrap-checker' })).toThrow();
    expect(() => assertHostedCandidateWorkspaceMutationObservation({ ...observation, status: ' M bun.lock\0' })).toThrow();
  });

  test('checkout preflight strictly bounds expanded bytes and exact tree entries', () => {
    const entry = (mode: string, type: string, size: string, name: string) => `${mode} ${type} ${subject.headSha} ${size}\t${name}\0`;
    expect(() => assertHostedCandidateWorkspaceTreeInventory('')).not.toThrow();
    expect(() => assertHostedCandidateWorkspaceTreeInventory(entry('100644', 'blob', '134217728', 'file'))).not.toThrow();
    expect(() => assertHostedCandidateWorkspaceTreeInventory(entry('100755', 'blob', '1', 'tool')
      + entry('120000', 'blob', '4', 'link'))).not.toThrow();
    for (const invalid of [entry('100644', 'blob', '134217729', 'large'),
      entry('100644', 'blob', '134217728', 'a') + entry('100644', 'blob', '1', 'b'),
      entry('100644', 'blob', '9007199254740993', 'unsafe'), entry('160000', 'commit', '-', 'submodule'),
      entry('100600', 'blob', '1', 'mode'), entry('100644', 'tree', '1', 'type'),
      entry('100644', 'blob', '-1', 'negative'), entry('100644', 'blob', '1', 'é'.repeat(2049)), entry('100644', 'blob', '1', '../escape'),
      entry('100644', 'blob', '1', 'same').repeat(2),
      entry('100644', 'blob', '1', 'parent') + entry('100644', 'blob', '1', 'parent/file'),
      entry('100644', 'blob', '1', 'parent/file') + entry('100644', 'blob', '1', 'parent'), entry('100644', 'blob', '1', 'file').slice(0, -1), '\0']) {
      expect(() => assertHostedCandidateWorkspaceTreeInventory(invalid)).toThrow();
    }
    const tooManyPhysicalEntries = Array.from({ length: 100_001 }, (_, index) =>
      entry('100644', 'blob', '0', `d${index}/file`)).join('');
    expect(() => assertHostedCandidateWorkspaceTreeInventory(tooManyPhysicalEntries)).toThrow();
  });

  test('cleanup-unknown preserves exact residue identity and every original settlement failure', () => {
    const primary = new Error('body failed'), cleanup = new Error('close unknown');
    const failure = new ResourceCompositeSettlementError([{ label: 'body', error: primary }, { label: 'cleanup', error: cleanup }]);
    const parent = Object.freeze({ path: '/private-parent', finalPath: '/private-parent', objectId: '1:10', device: '1', inode: '10' });
    const generation = Object.freeze({ path: '/private-parent/owned', finalPath: '/private-parent/owned', objectId: '1:11', device: '1', inode: '11' });
    const recovery = Object.freeze({ parent, generation, subject, purpose: 'activation-static' as const,
      originIdentityDigest: `sha256:${'5'.repeat(64)}` as const, deadlineAtUnixMs: 1_000 });
    const error = new HostedCandidateWorkspaceCleanupUnknownError(recovery, failure);
    expect(error.code).toBe('hosted-candidate-workspace-cleanup-unknown');
    expect(error.recovery).toBe(recovery);
    expect(error.cause).toBe(failure);
    expect(error.failure).toBe(failure);
    expect(failure.errors).toEqual([primary, cleanup]);
  });

  test('serialized or copied origin data never enters the callback or materializes a workspace', async () => {
    let calls = 0;
    for (const origin of [{}, { role: 'trusted', phase: 'produce-hosted',
      trustedSourceSha: subject.baseSha, trustedSourceTreeSha: subject.baseTreeSha,
      trustedDriverRoot: '/unread-source', deadlineAtUnixMs: Date.now() + 60_000 }]) {
      await expect(withHostedCandidateWorkspace({ origin: origin as AuthenticatedGitHubJobOrigin,
        subject, purpose: 'activation-static' }, async () => { calls += 1; })).rejects.toMatchObject({
        code: 'hosted-candidate-workspace-unavailable', reason: 'origin'
      });
    }
    expect(calls).toBe(0);
  });
});
