import { sha256 } from '../../../contracts/canonical.ts';
import { compileClosedDirectedGraphStrongComponents } from '../../../contracts/directed-graph.ts';
import type {
  SourceProgramDeclaration,
  SourceProgramReferenceKind
} from './contract.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';

export type SourceProgramDeclarationTopologyEdge = Readonly<{
  readonly sourceObservationId: string;
  readonly targetObservationId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly kind: SourceProgramReferenceKind;
}>;

export type SourceProgramDeclarationTopologyUnknown = Readonly<{
  readonly code: 'module-initialization-relation' | 'target-unresolved' | 'source-declaration-unresolved';
  readonly path: string;
  readonly targetPath: string | null;
  readonly referenceKind: SourceProgramReferenceKind;
  readonly span: Readonly<{ readonly start: number; readonly end: number }>;
}>;

export type SourceProgramDeclarationStrongComponent = Readonly<{
  readonly componentId: `sha256:${string}`;
  readonly declarationObservationIds: readonly string[];
  readonly paths: readonly string[];
}>;

export type SourceProgramDeclarationTopology = Readonly<{
  readonly compilationReceiptDigest: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly modelDigest: string;
  readonly declarations: readonly SourceProgramDeclaration[];
  readonly edges: readonly SourceProgramDeclarationTopologyEdge[];
  readonly strongComponents: readonly SourceProgramDeclarationStrongComponent[];
  readonly unknowns: readonly SourceProgramDeclarationTopologyUnknown[];
  readonly topologyDigest: `sha256:${string}`;
}>;

function textOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function declarationStrongComponents(
  declarations: readonly SourceProgramDeclaration[],
  edges: readonly SourceProgramDeclarationTopologyEdge[]
): readonly SourceProgramDeclarationStrongComponent[] {
  const components = compileClosedDirectedGraphStrongComponents(
    declarations.map(({ observationId }) => observationId),
    edges.map(({ sourceObservationId: from, targetObservationId: to }) => ({ from, to }))
  );
  const declarationById = new Map(declarations.map((declaration) => (
    [declaration.observationId, declaration] as const
  )));
  return Object.freeze(components.map((declarationObservationIds) => {
    const paths = [...new Set(declarationObservationIds.map((id) => declarationById.get(id)!.path))]
      .sort(textOrder);
    const canonical = { declarationObservationIds, paths };
    return Object.freeze({
      componentId: sha256(canonical) as `sha256:${string}`,
      declarationObservationIds: Object.freeze(declarationObservationIds),
      paths: Object.freeze(paths)
    });
  }).sort((left, right) => textOrder(left.componentId, right.componentId)));
}

/**
 * Compile the declaration relation graph exactly once from one compiler-issued
 * Source Program receipt. It does not read source, infer references from spans,
 * classify owners, or authorize physical placement.
 */
export function compileSourceProgramDeclarationTopology(
  compilation: RepositorySourceProgramCompilationReceipt
): SourceProgramDeclarationTopology {
  assertRepositorySourceProgramCompilationReceipt(compilation);
  const model = compilation.model;
  const productionPaths = new Set(model.files
    .filter(({ surface }) => surface === 'production')
    .map(({ path }) => path));
  const declarations = Object.freeze(model.declarations
    .filter(({ path }) => productionPaths.has(path))
    .sort((left, right) => textOrder(left.observationId, right.observationId)));
  const declarationById = new Map(declarations.map((declaration) => (
    [declaration.observationId, declaration] as const
  )));
  const edges: SourceProgramDeclarationTopologyEdge[] = [];
  const unknowns: SourceProgramDeclarationTopologyUnknown[] = [];
  for (const reference of model.references) {
    if (!productionPaths.has(reference.path)) continue;
    if (reference.sourceRelation === 'module-initialization') {
      unknowns.push(Object.freeze({
        code: 'module-initialization-relation',
        path: reference.path,
        targetPath: reference.targetPath,
        referenceKind: reference.kind,
        span: reference.span
      }));
      continue;
    }
    if (reference.sourceObservationId === null
        || !declarationById.has(reference.sourceObservationId)) {
      unknowns.push(Object.freeze({
        code: 'source-declaration-unresolved',
        path: reference.path,
        targetPath: reference.targetPath,
        referenceKind: reference.kind,
        span: reference.span
      }));
      continue;
    }
    if (reference.targetObservationId === null
        || !declarationById.has(reference.targetObservationId)) {
      unknowns.push(Object.freeze({
        code: 'target-unresolved',
        path: reference.path,
        targetPath: reference.targetPath,
        referenceKind: reference.kind,
        span: reference.span
      }));
      continue;
    }
    const source = declarationById.get(reference.sourceObservationId)!;
    const target = declarationById.get(reference.targetObservationId)!;
    edges.push(Object.freeze({
      sourceObservationId: source.observationId,
      targetObservationId: target.observationId,
      sourcePath: source.path,
      targetPath: target.path,
      kind: reference.kind
    }));
  }
  const uniqueEdges = [...new Map(edges.map((edge) => [
    `${edge.sourceObservationId}\0${edge.targetObservationId}\0${edge.kind}`,
    edge
  ])).values()].sort((left, right) => textOrder(
    `${left.sourceObservationId}\0${left.targetObservationId}\0${left.kind}`,
    `${right.sourceObservationId}\0${right.targetObservationId}\0${right.kind}`
  ));
  const sortedUnknowns = unknowns.sort((left, right) => textOrder(
    `${left.path}\0${left.span.start}\0${left.referenceKind}\0${left.code}`,
    `${right.path}\0${right.span.start}\0${right.referenceKind}\0${right.code}`
  ));
  const strongComponents = declarationStrongComponents(declarations, uniqueEdges);
  const canonical = {
    compilationReceiptDigest: compilation.receiptDigest,
    sourceRevision: model.sourceRevision,
    modelDigest: model.modelDigest,
    declarationObservationIds: declarations.map(({ observationId }) => observationId),
    edges: uniqueEdges,
    strongComponents,
    unknowns: sortedUnknowns
  };
  return Object.freeze({
    compilationReceiptDigest: compilation.receiptDigest,
    sourceRevision: model.sourceRevision,
    modelDigest: model.modelDigest,
    declarations,
    edges: Object.freeze(uniqueEdges),
    strongComponents,
    unknowns: Object.freeze(sortedUnknowns),
    topologyDigest: sha256(canonical) as `sha256:${string}`
  });
}
