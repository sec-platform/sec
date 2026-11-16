import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../../architecture/contract.ts';
import {
  compileSourceProgramSupersessionEvidence,
  compileSourceProgramSupersessionEvidenceIdentity
} from '../reduction.ts';
import { compileRepositorySourceProgramModel, compileSourceProgramOwnerIntentEvidence } from '../repository.ts';
import { compileSourceProgramTestValue } from '../test-value.ts';
import { compileTypeScriptSourceProgramModel } from '../typescript.ts';
import { compileWorkspaceSourceRevision } from '../workspace-source-snapshot.ts';

export function compileSupersessionFixture(
  sources: Readonly<Record<string, string>>,
  declareIntent = true,
  declareObligation = declareIntent,
  aggregateBudgets: readonly Readonly<{
    resource: 'duration-ms' | 'input-bytes' | 'output-bytes' | 'processes' | 'records';
    maximum: number;
  }>[] = [{ resource: 'duration-ms', maximum: 30_000 }]
) {
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: declareIntent
      ? [{ capability: 'example-operation', operations: ['execute'] }]
      : [],
    operationObligations: declareIntent && declareObligation
      ? [{
          operation: {
            kind: 'capability',
            capability: 'example-operation',
            operation: 'execute'
          },
          consumerSupport: { consumers: [] },
          effect: { kinds: [], failureKinds: [], recovery: 'not-applicable' },
          evolution: {
            migration: 'not-required',
            retirement: 'replacement-obligations-satisfied'
          },
          resources: {
            aggregateBudgets
          },
          futureSupport: { condition: 'semantic-superset-required' }
        }]
      : [],
    preDependencyBootstrap: false
  });
  const descriptorPath = 'src/example/module.json';
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({
      path,
      mode: '100644' as const,
      source,
      contentDigest: rawSha256(source)
    }));
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const sourceRevision = compileWorkspaceSourceRevision(files);
  const typeScriptModel = compileTypeScriptSourceProgramModel({
    sourceRevision,
    files,
    moduleMembership: membership
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership: membership,
    typescriptModel: typeScriptModel
  });
  const tests = compileSourceProgramTestValue({
    repositoryRoot: 'C:/synthetic/repository',
    files,
    model
  });
  const full = Object.freeze({
    model,
    typeScriptModel,
    tests,
    intentEvidence: compileSourceProgramOwnerIntentEvidence(model, membership)
  });
  const inputDigest = sha256({
    paths: files.map(({ path, contentDigest }) => ({ path, contentDigest })),
    descriptorSource
  });
  const identityInput = Object.freeze({
    revisionDigest: sha256({ revision: sourceRevision }),
    treeDigest: sourceRevision,
    toolchainDigest: sha256({ toolchain: 'synthetic-typescript-compiler' }),
    configurationDigest: inputDigest
  });
  const identity = compileSourceProgramSupersessionEvidenceIdentity(identityInput);
  return Object.freeze({
    files,
    membership,
    full,
    identityInput,
    identity,
    evidence: compileSourceProgramSupersessionEvidence({
      ...full,
      identity
    })
  });
}

export function compileSupersessionSnapshot(
  sources: Readonly<Record<string, string>>,
  declareIntent = true,
  declareObligation = declareIntent
) {
  return compileSupersessionFixture(sources, declareIntent, declareObligation).evidence;
}
