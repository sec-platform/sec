import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  addBlock,
  buildWorkspaceEngineeringIR,
  initWorkspace,
  resolveWorkspace
} from '../../src/bootstrap/engineering/cli.ts';
import { runPolicyGate } from '../../src/adapters/verification/run-policy-gate.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { pathExists, writeJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('workspace builds one deterministic canonical Engineering IR independent of derived artifacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    await addBlock(workspaceRoot, 'ticket/basic');
    await resolveWorkspace(workspaceRoot);
    const paths = getWorkspacePaths(workspaceRoot);
    const explainGraphPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph);
    const policyReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
    await fs.mkdir(paths.policiesRoot, { recursive: true });
    await writeYaml(path.join(paths.policiesRoot, 'canonical-policy.yaml'), {
      policies: [{
        id: 'canonical-source-policy',
        severity: 'warn',
        appliesTo: ['ticket/basic'],
        rule: 'declaration_only_for_revision_stability'
      }]
    });

    const first = await buildWorkspaceEngineeringIR(workspaceRoot);
    const second = await buildWorkspaceEngineeringIR(workspaceRoot);

    expect(second).toEqual(first);
    expect(first.entities.find((entity) => entity.id === 'responsibility:ticket:TicketLifecycle')?.kind).toBe('responsibility');
    expect(first.entities.find((entity) => entity.id === 'responsibility:tenant:TenantScopeGuard')?.kind).toBe('responsibility');
    expect(first.entities.find((entity) => entity.id === 'state:ticket:ticket-status')?.kind).toBe('state');
    expect(first.facts.some((fact) =>
      fact.subject === 'operation:ticket:listTickets' &&
      fact.predicate === 'REQUIRES_PERMISSION' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'permission:ticket:ticket-read'
    )).toBe(true);
    expect(first.facts.some((fact) =>
      fact.subject === 'responsibility:ticket:TicketQuery' &&
      fact.predicate === 'DEPENDS_ON' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'responsibility:tenant:TenantScopeGuard'
    )).toBe(true);
    expect(first.facts.some((fact) =>
      fact.subject === 'policy:tenant-scope-required' &&
      fact.predicate === 'ENFORCES' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'policy:tenant:tenant-scope'
    )).toBe(true);
    expect(first.scenarios.map((scenario) => scenario.id)).toEqual([
      'scenario:ticket:create-ticket',
      'scenario:ticket:list-tenant-tickets',
      'scenario:ticket:transition-ticket-status'
    ]);

    const policyEntities = first.entities.filter((entity) => entity.kind === 'policy');
    expect(policyEntities.map((entity) => entity.id)).toContain('policy:canonical-source-policy');
    expect(await pathExists(policyReportPath)).toBe(false);

    const report = await runPolicyGate(workspaceRoot);
    await writeJson(policyReportPath, report);
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await fs.writeFile(
      provenancePath,
      JSON.stringify({ artifacts: [{ path: 'changed.ts', generatedAt: Date.now() }] }),
      'utf8'
    );
    await fs.mkdir(path.dirname(explainGraphPath), { recursive: true });
    await fs.writeFile(
      explainGraphPath,
      JSON.stringify({ nodes: ['changed'], generatedAt: Date.now() }),
      'utf8'
    );
    const afterDerivedArtifacts = await buildWorkspaceEngineeringIR(workspaceRoot);
    expect(afterDerivedArtifacts).toEqual(first);
  }, 'engineering-compiler-semantic-ir-');
}, 30_000);
