import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  compileSecRepositoryModuleGraph,
  normalizeSecRepositoryPath,
  type SecRepositoryModuleGraph,
  type SecRepositoryModuleMembership
} from '../../system-architecture/repository-modules/contract.ts';
import type { SourceProgramFileInput, SourceProgramModel } from './contract.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY_GRAPH_INPUT = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$/iu;
const repositoryCompilationContextBrand: unique symbol = Symbol('repository-compilation-context');
const issuedRepositoryCompilationContexts = new WeakSet<object>();

export type RepositoryCompilationGraphConsumer =
  | 'repository-audit'
  | 'repository-model'
  | 'test-impact'
  | 'test-observations'
  | 'typescript';

export type RepositoryCompilationSubject =
  | Readonly<{
      kind: 'physical-repository';
      provenance: Readonly<{
        kind: 'git-tree' | 'working-tree-observation';
        identityDigest: `sha256:${string}`;
      }>;
    }>
  | Readonly<{
      kind: 'virtual-mutation';
      provenance: Readonly<{
        kind: 'source-program-virtual-mutation';
        baseSnapshotDigest: `sha256:${string}`;
        mutationDigest: `sha256:${string}`;
      }>;
    }>;

type RepositoryCompilationMatchInput = Readonly<{
  sourceRevision?: string;
  productionModel?: SourceProgramModel;
  files: readonly SourceProgramFileInput[];
  moduleMembership: SecRepositoryModuleMembership;
}>;

export type IssueRepositoryCompilationContextInput = Readonly<{
  subject: RepositoryCompilationSubject;
  sourceRevision: string;
  files: readonly SourceProgramFileInput[];
  moduleMembership: SecRepositoryModuleMembership;
}>;

/** Process-local capability for projections of one exact repository subject. */
export interface IssuedRepositoryCompilationContext {
  readonly [repositoryCompilationContextBrand]: true;
  readonly subject: RepositoryCompilationSubject;
  readonly subjectDigest: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly contextDigest: `sha256:${string}`;
  readonly moduleGraphCompilationCount: 1;
  readonly moduleGraph: SecRepositoryModuleGraph;
  moduleGraphFor(consumer: RepositoryCompilationGraphConsumer): SecRepositoryModuleGraph;
  observedModuleGraphConsumers(): readonly RepositoryCompilationGraphConsumer[];
  assertMatches(input: RepositoryCompilationMatchInput): void;
}

export function assertIssuedRepositoryCompilationContext(
  context: IssuedRepositoryCompilationContext
): void {
  if (!issuedRepositoryCompilationContexts.has(context)) {
    throw new Error('Repository compilation context was not issued by the Source Program owner');
  }
}

function exactDigest(value: string, label: string): asserts value is `sha256:${string}` {
  if (!DIGEST.test(value)) throw new Error(`${label} must be one exact sha256 digest`);
}

function canonicalSubject(subject: RepositoryCompilationSubject): RepositoryCompilationSubject {
  if (subject.kind === 'physical-repository') {
    if (subject.provenance.kind !== 'git-tree'
        && subject.provenance.kind !== 'working-tree-observation') {
      throw new Error('Repository compilation physical provenance is invalid');
    }
    exactDigest(subject.provenance.identityDigest, 'Repository compilation physical provenance');
    return Object.freeze({ kind: subject.kind, provenance: Object.freeze({ ...subject.provenance }) });
  }
  if (subject.provenance.kind !== 'source-program-virtual-mutation') {
    throw new Error('Repository compilation virtual provenance is invalid');
  }
  exactDigest(subject.provenance.baseSnapshotDigest, 'Repository compilation virtual base');
  exactDigest(subject.provenance.mutationDigest, 'Repository compilation virtual mutation');
  return Object.freeze({ kind: subject.kind, provenance: Object.freeze({ ...subject.provenance }) });
}

function canonicalFiles(files: readonly SourceProgramFileInput[]): readonly SourceProgramFileInput[] {
  const canonical = files.map((file) => {
    const repositoryPath = normalizeSecRepositoryPath(file.path);
    if (repositoryPath !== file.path || repositoryPath.length === 0) {
      throw new Error(`Repository compilation file path is not canonical: ${file.path}`);
    }
    if (rawSha256(file.source) !== file.contentDigest) {
      throw new Error(`Repository compilation file digest does not bind source bytes: ${file.path}`);
    }
    return Object.freeze({ path: repositoryPath, source: file.source, contentDigest: file.contentDigest });
  }).sort((left, right) => compareCodeUnits(left.path, right.path));
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1]!.path === canonical[index]!.path) {
      throw new Error(`Repository compilation snapshot contains duplicate path: ${canonical[index]!.path}`);
    }
  }
  return Object.freeze(canonical);
}

function snapshotDigest(files: readonly SourceProgramFileInput[]): `sha256:${string}` {
  return sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))) as `sha256:${string}`;
}

function membershipDigest(
  files: readonly SourceProgramFileInput[],
  membership: SecRepositoryModuleMembership
): `sha256:${string}` {
  return sha256({
    graphRoots: [...membership.graphRoots].sort(compareCodeUnits),
    moduleRoots: [...membership.moduleRoots].sort(compareCodeUnits),
    fileBindings: files.map(({ path }) => ({ path, module: membership.moduleForPath(path) }))
  }) as `sha256:${string}`;
}

function graphDigest(graph: SecRepositoryModuleGraph): `sha256:${string}` {
  return sha256({ files: graph.files, references: graph.references, unresolvedFiles: graph.unresolvedFiles }) as `sha256:${string}`;
}

export function issueRepositoryCompilationContext(
  input: IssueRepositoryCompilationContextInput
): IssuedRepositoryCompilationContext {
  if (input.sourceRevision.trim().length === 0) {
    throw new Error('Repository compilation requires a non-empty exact source revision');
  }
  const subject = canonicalSubject(input.subject);
  const files = canonicalFiles(input.files);
  const exactSnapshotDigest = snapshotDigest(files);
  const exactMembershipDigest = membershipDigest(files, input.moduleMembership);
  const sourceByPath = new Map(files.map((file) => [file.path, file.source] as const));
  const moduleGraph = compileSecRepositoryModuleGraph({
    files: files.filter(({ path }) => REPOSITORY_GRAPH_INPUT.test(path)).map(({ path }) => path),
    readSource: (repositoryPath) => sourceByPath.get(repositoryPath) ?? null
  });
  const exactModuleGraphDigest = graphDigest(moduleGraph);
  const moduleGraphConsumers = new Set<RepositoryCompilationGraphConsumer>();
  const subjectDigest = sha256(subject) as `sha256:${string}`;
  const contextDigest = sha256({
    schema: 'sec-repository-source-program-compilation-context-v1',
    subjectDigest,
    sourceRevision: input.sourceRevision,
    snapshotDigest: exactSnapshotDigest,
    moduleMembershipDigest: exactMembershipDigest,
    moduleGraphDigest: exactModuleGraphDigest
  }) as `sha256:${string}`;
  const assertMatches = (candidate: RepositoryCompilationMatchInput): void => {
    const candidateFiles = canonicalFiles(candidate.files);
    const candidateRevision = candidate.sourceRevision ?? candidate.productionModel?.sourceRevision;
    if (candidateRevision !== input.sourceRevision
        || snapshotDigest(candidateFiles) !== exactSnapshotDigest
        || membershipDigest(candidateFiles, candidate.moduleMembership) !== exactMembershipDigest
        || graphDigest(moduleGraph) !== exactModuleGraphDigest) {
      throw new Error('Repository compilation context does not bind the supplied exact snapshot');
    }
  };
  const context: IssuedRepositoryCompilationContext = Object.freeze({
    [repositoryCompilationContextBrand]: true as const,
    subject,
    subjectDigest,
    sourceRevision: input.sourceRevision,
    snapshotDigest: exactSnapshotDigest,
    moduleMembershipDigest: exactMembershipDigest,
    moduleGraphDigest: exactModuleGraphDigest,
    contextDigest,
    moduleGraphCompilationCount: 1 as const,
    moduleGraph,
    moduleGraphFor: (consumer: RepositoryCompilationGraphConsumer) => {
      moduleGraphConsumers.add(consumer);
      return moduleGraph;
    },
    observedModuleGraphConsumers: () => Object.freeze([...moduleGraphConsumers].sort(compareCodeUnits)),
    assertMatches
  });
  issuedRepositoryCompilationContexts.add(context);
  return context;
}
