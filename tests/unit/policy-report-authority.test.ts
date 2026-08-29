import { expect, test } from 'bun:test';

import { validatePolicyReport } from '../../src/compiler/policies/report.ts';

function emptyPolicyReport() {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  } as const;
}

function structuralPolicyReport() {
  const sourcePath = 'catalog/policies/official/tenant.yaml';
  return {
    status: 'passed',
    official: {
      policies: ['tenant_scope'],
      sources: [{ path: sourcePath, policyIds: ['tenant_scope'] }],
      violations: []
    },
    project: { policies: [], sources: [], violations: [] },
    merged: {
      policies: [{
        id: 'tenant_scope',
        sourceScope: 'official',
        sourcePath,
        targets: ['src/installed/customer/service.ts']
      }]
    },
    violations: [],
    diagnostics: [{
      id: 'tenant_scope',
      severity: 'error',
      appliesTo: ['entity/customer-basic'],
      rule: 'tenant_context_must_flow_to_query',
      files: ['src/installed/customer/service.ts'],
      message: 'Source structure is advisory only.',
      sourceScope: 'official',
      sourcePath,
      evidenceClass: 'source-structure'
    }],
    evaluation: {
      providerId: 'sec-policy-source-structure',
      providerRevision: 'tenant-context-structure-v1',
      assurance: 'source-structure',
      requiredSemanticPredicates: ['FLOWS_TO'],
      unsupportedSemanticPredicates: ['FLOWS_TO']
    }
  } as const;
}

test('Policy Report authority accepts not-applicable empty inventory and canonicalizes migration diagnostics', () => {
  const { diagnostics, ...legacy } = emptyPolicyReport();
  const report = validatePolicyReport(legacy);
  expect(report.status).toBe('skipped');
  expect(report.diagnostics).toEqual([]);
  expect(Object.isFrozen(report)).toBe(true);
});

test('Policy Report authority preserves source-structure diagnostics without treating them as violations', () => {
  const report = validatePolicyReport(structuralPolicyReport());
  expect(report.status).toBe('passed');
  expect(report.violations).toEqual([]);
  expect(report.diagnostics).toHaveLength(1);
  expect(report.evaluation?.assurance).toBe('source-structure');
});

test('Policy Report authority rejects forged status and missing evaluator assurance', () => {
  const forged = structuredClone(structuralPolicyReport()) as any;
  forged.status = 'failed';
  expect(() => validatePolicyReport(forged)).toThrow('status differs');

  const noEvaluation = structuredClone(structuralPolicyReport()) as any;
  delete noEvaluation.evaluation;
  expect(() => validatePolicyReport(noEvaluation)).toThrow('evaluator assurance');
});

test('Policy Report authority rejects merged policy that is not bound to its declared winning source', () => {
  const candidate = structuredClone(structuralPolicyReport()) as any;
  candidate.merged.policies[0].sourcePath = 'source/model/policies/other.yaml';
  expect(() => validatePolicyReport(candidate)).toThrow('winner');
});

test('Policy Report authority makes canonical source/model declaration win over project copies', () => {
  const candidate = structuredClone(structuralPolicyReport()) as any;
  candidate.official = { policies: [], sources: [], violations: [] };
  candidate.project = {
    policies: ['tenant_scope'],
    sources: [
      { path: 'project/policies/tenant.yaml', policyIds: ['tenant_scope'] },
      { path: 'source/model/policies/tenant.yaml', policyIds: ['tenant_scope'] }
    ],
    violations: []
  };
  candidate.merged.policies[0].sourceScope = 'project';
  candidate.merged.policies[0].sourcePath = 'source/model/policies/tenant.yaml';
  candidate.diagnostics[0].sourceScope = 'project';
  candidate.diagnostics[0].sourcePath = 'source/model/policies/tenant.yaml';
  expect(validatePolicyReport(candidate).merged.policies[0].sourcePath)
    .toBe('source/model/policies/tenant.yaml');

  candidate.merged.policies[0].sourcePath = 'project/policies/tenant.yaml';
  expect(() => validatePolicyReport(candidate)).toThrow('winner');
});

test('Policy Report authority rejects noncanonical identity and finding order', () => {
  const badId = structuredClone(structuralPolicyReport()) as any;
  badId.official.policies = ['Tenant Scope'];
  expect(() => validatePolicyReport(badId)).toThrow();

  const findings = structuredClone(structuralPolicyReport()) as any;
  findings.diagnostics.push({
    ...findings.diagnostics[0],
    message: 'A diagnostic that sorts before Source.'
  });
  expect(() => validatePolicyReport(findings)).toThrow('canonically ordered');
});

test('Policy Report authority uses code-unit order instead of host locale order', () => {
  const candidate = structuredClone(structuralPolicyReport()) as any;
  const template = candidate.diagnostics[0];
  candidate.diagnostics = [
    { ...template, message: 'Z' },
    { ...template, message: 'a' }
  ];
  expect((validatePolicyReport(candidate).diagnostics ?? []).map((entry) => entry.message))
    .toEqual(['Z', 'a']);

  candidate.diagnostics.reverse();
  expect(() => validatePolicyReport(candidate)).toThrow('canonically ordered');
});

test('Policy Report authority rejects duplicate semantic findings', () => {
  const candidate = structuredClone(structuralPolicyReport()) as any;
  candidate.diagnostics.push(structuredClone(candidate.diagnostics[0]));
  expect(() => validatePolicyReport(candidate)).toThrow('duplicate semantic findings');
});
