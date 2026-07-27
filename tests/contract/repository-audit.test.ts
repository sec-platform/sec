import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_OWNERS
} from '../../platform/shared/agent-skill-contract.ts';
import {
  auditRepository,
  extractHeuristicBehaviorCandidates
} from '../../scripts/codex/repository-audit.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

test('behavior registry is a one-to-one closed inventory', () => {
  expect(SEC_REPOSITORY_BEHAVIOR_IDS).toHaveLength(SEC_AGENT_SKILL_IDS.length);
  expect(new Set(Object.values(SEC_REPOSITORY_BEHAVIOR_OWNERS))).toEqual(
    new Set(SEC_AGENT_SKILL_IDS)
  );
});

test('heuristic candidate extraction ignores historical authority but exposes hidden Agent rules', () => {
  expect(extractHeuristicBehaviorCandidates(
    'docs/archive/old-plan.md',
    'Agent 必须直接合并。'
  )).toEqual([]);

  const candidates = extractHeuristicBehaviorCandidates(
    'platform/example.ts',
    '// Codex Agent 必须在失败时重复整套验证。'
  );
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    line: 1,
    path: 'platform/example.ts',
    skills: []
  });
});

test('full repository audit classifies every tracked path and has no blocking finding', async () => {
  const report = await auditRepository(REPOSITORY_ROOT);

  expect(report.schema).toBe('sec-repository-audit-v1');
  expect(report.summary.trackedPaths).toBeGreaterThan(0);
  expect(report.summary.skills).toBe(SEC_AGENT_SKILL_IDS.length);
  expect(Object.values(report.surfaces).reduce((sum, count) => sum + count, 0))
    .toBe(report.summary.trackedPaths);
  expect(report.findings.filter((finding) =>
    finding.severity === 'critical' || finding.severity === 'high')).toEqual([]);
  expect(report.findings.some((finding) =>
    finding.code === 'partial-discovery-named-all')).toBe(false);
});
