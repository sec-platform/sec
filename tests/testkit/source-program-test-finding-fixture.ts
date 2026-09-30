import type { CompileSourceProgramAuditOperationInput } from '../../src/adapters/repository/repository-audit/source-program-audit-operation.ts';
import type { SourceProgramTestFindingDelta } from '../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const digest = (value: unknown): `sha256:${string}` => sha256(value) as `sha256:${string}`;

/** Synthetic parent-normalized data for pure audit/codec tests only. The fixture
 * explicitly contains no selected test modules. Its shared inputs and runtime
 * isolation remain unassessed; this does not issue compilation or author proof. */
export function syntheticTestFindingComparison(
  facts: CompileSourceProgramAuditOperationInput,
  findings = facts.testDisposition.findings
): Pick<CompileSourceProgramAuditOperationInput, 'testFindingDelta' | 'testValue'> {
  const context = Object.freeze({
    analysisPolicyDigest: digest('fixture-analysis'), compilerRevision: digest('fixture-compiler'),
    providerRevision: digest('fixture-provider'), compilerConfigDigest: digest('fixture-config'),
    dependencyGenerationDigest: digest('fixture-dependencies'), environmentDigest: digest('fixture-environment'),
    projectConfigDigest: null, providersDigest: digest([]),
    testDefinitionContextDigest: digest('fixture-unassessed-shared-inputs'),
    testDefinitionContextReadSetDigest: digest([])
  });
  const common = {
    runtimeIsolation: 'unassessed' as const, selectedPaths: [], unobservedPaths: [],
    localUnobservedInputs: [], sharedContextUnobserved: true,
    moduleMembershipDigest: digest('fixture-empty-test-inventory'), context,
    contextDigest: digest(context), incompleteContextFields: []
  };
  const groups = new Map<string, typeof findings[number][]>();
  for (const finding of findings) {
    const key = JSON.stringify([finding.code, finding.path]);
    const group = groups.get(key) ?? []; group.push(finding); groups.set(key, group);
  }
  const entries = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => ({
    identityDigest: digest({ code: group[0]!.code, path: group[0]!.path }),
    code: group[0]!.code, path: group[0]!.path, status: 'introduced' as const,
    beforeFindingDigests: [], afterFindingDigests: group.map(digest).sort(),
    beforeSubjectDigest: null, afterSubjectDigest: digest({ fixtureMissingTestSubject: group[0]!.path })
  }));
  const findingsDigest = digest(findings.map(digest).sort());
  const unsigned: Omit<SourceProgramTestFindingDelta, 'deltaDigest'> = {
    before: { ...common, ...facts.reconciliation.before,
      testCompilationDigest: facts.supersession.baseline.testCompilationDigest, findingsDigest: digest([]) },
    after: { ...common, sourceRevision: facts.sourceProgram.sourceRevision,
      modelDigest: facts.sourceProgram.modelDigest,
      compilationReceiptDigest: facts.sourceProgramCompilation.receiptDigest,
      testCompilationDigest: facts.testValue.compilationDigest, findingsDigest },
    contextComparable: true, changedContextFields: [], changedSharedInputPaths: [],
    scope: { addedPaths: [], removedPaths: [], regressedPaths: [] }, entries,
    counts: { introduced: entries.length, persistent: 0, changed: 0, absent: 0, 'out-of-scope': 0, unobserved: 0 }
  };
  return { testFindingDelta: { ...unsigned, deltaDigest: digest(unsigned) },
    testValue: { ...facts.testValue, findingsDigest } };
}
