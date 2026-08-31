import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import {
  assertIssuedRepositoryCompilationContext,
  issueRepositoryCompilationContext,
  type IssuedRepositoryCompilationContext,
  type RepositoryCompilationSubject
} from './repository-compilation-context.ts';
import {
  compileRepositorySourceProgramCompilation
} from './repository-compilation.ts';
import { compileRepositorySourceProgramModelFromRepositoryCompilation } from './repository.ts';
import {
  compileSourceProgramTestObservationsFromRepositoryCompilation,
  repositoryCompilationDigestForTestObservations
} from './test-observations.ts';
import {
  compileTypeScriptSourceProgramModelFromRepositoryCompilation,
  repositoryCompilationDigestForTypeScriptModel
} from './typescript.ts';

function fixture(value: number) {
  const descriptorPath = 'src/example/sec.module.json';
  const sources = Object.freeze({
    'src/example/operation.ts': `export const value = ${value};\n`,
    'tests/example.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { value } from '../src/example/operation.ts';",
      "test('value', () => expect(value).toBeGreaterThan(0));",
      ''
    ].join('\n')
  });
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({
      path,
      source,
      contentDigest: rawSha256(source)
    }));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [],
        preDependencyBootstrap: false
      })
    }]
  });
  return Object.freeze({
    files: Object.freeze(files),
    moduleMembership,
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })))
  });
}

function physicalSubject(identity: string): RepositoryCompilationSubject {
  return Object.freeze({
    kind: 'physical-repository',
    provenance: Object.freeze({
      kind: 'working-tree-observation',
      identityDigest: sha256(identity) as `sha256:${string}`
    })
  });
}

test('one exact physical repository receipt compiles one graph for every Source Program projection', () => {
  const input = fixture(1);
  const receipt = compileRepositorySourceProgramCompilation({
    ...input,
    subject: physicalSubject('physical-observation')
  });

  expect(receipt.subject.kind).toBe('physical-repository');
  expect(receipt.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(receipt.moduleGraphDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(receipt.moduleGraphCompilationCount).toBe(1);
  expect(receipt.context.moduleGraphCompilationCount).toBe(1);
  expect(receipt.moduleGraphConsumersAtCompilation).toEqual([
    'repository-model',
    'test-observations',
    'typescript'
  ]);
  expect(receipt.context.moduleGraph.files).toEqual([
    'src/example/operation.ts',
    'tests/example.test.ts'
  ]);
  expect(repositoryCompilationDigestForTypeScriptModel(receipt.typeScriptCompilation.model))
    .toBe(receipt.contextDigest);
  expect(repositoryCompilationDigestForTestObservations(receipt.testObservations))
    .toBe(receipt.contextDigest);
  expect(receipt.model.sourceRevision).toBe(input.sourceRevision);
  expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('repository compilation contexts reject fact mixing and keep virtual mutation explicit', () => {
  const left = fixture(1);
  const right = fixture(1);
  const leftContext = issueRepositoryCompilationContext({
    ...left,
    subject: physicalSubject('left-observation')
  });
  const virtualSubject: RepositoryCompilationSubject = Object.freeze({
    kind: 'virtual-mutation',
    provenance: Object.freeze({
      kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: leftContext.snapshotDigest,
      mutationDigest: sha256('replace value') as `sha256:${string}`
    })
  });
  const rightContext = issueRepositoryCompilationContext({
    ...right,
    subject: virtualSubject
  });
  const leftModel = compileTypeScriptSourceProgramModelFromRepositoryCompilation(left, leftContext);
  const rightModel = compileTypeScriptSourceProgramModelFromRepositoryCompilation(right, rightContext);

  expect(rightContext.subject.kind).toBe('virtual-mutation');
  expect(() => compileSourceProgramTestObservationsFromRepositoryCompilation({
    productionModel: leftModel,
    files: right.files,
    moduleMembership: right.moduleMembership
  }, rightContext)).toThrow('cannot mix a production model');

  const leftObservations = compileSourceProgramTestObservationsFromRepositoryCompilation({
    productionModel: leftModel,
    files: left.files,
    moduleMembership: left.moduleMembership
  }, leftContext);
  expect(() => compileRepositorySourceProgramModelFromRepositoryCompilation({
    ...right,
    typescriptModel: rightModel,
    testObservations: leftObservations
  }, rightContext)).toThrow('cannot mix test facts');
});

test('repository compilation context origin cannot be forged by structural copying', () => {
  const input = fixture(1);
  const issued = issueRepositoryCompilationContext({
    ...input,
    subject: physicalSubject('issued-context')
  });
  expect(() => assertIssuedRepositoryCompilationContext(issued)).not.toThrow();

  const forged = Object.freeze({ ...issued }) as IssuedRepositoryCompilationContext;
  expect(() => assertIssuedRepositoryCompilationContext(forged))
    .toThrow('was not issued by the Source Program owner');
});
