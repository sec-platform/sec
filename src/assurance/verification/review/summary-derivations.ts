import type { LockFile } from '../../../compiler/contract.ts';
import { compareCodeUnits, uniqueSorted } from '../../../contracts/canonical.ts';
import { countMatching } from '../../../contracts/collections.ts';
import { semanticViewFactIds } from '../../../semantics/projection/types.ts';
import type { OverrideStatus, ProvenanceFile, ProvenanceOriginType } from '../../../semantics/provenance/types.ts';
import type { ReviewSemanticViewSummary, ReviewSummary } from './contract/types.ts';

export function buildSemanticViewSummary(lock: LockFile): ReviewSemanticViewSummary | undefined {
  const semanticViews = lock.semanticViews;
  if (!semanticViews) return undefined;
  const views = semanticViews.views.map((view) => {
    const factIds = semanticViewFactIds(view);
    return {
      viewKind: view.viewKind,
      ...(view.subject ? { subject: view.subject } : {}),
      nodeCount: view.nodes.length,
      edgeCount: view.edges.length,
      factCount: factIds.length,
      factIds
    };
  });
  const factIds = uniqueSorted(views.flatMap((view) => view.factIds));
  return {
    formatVersion: semanticViews.formatVersion,
    inputRevision: semanticViews.inputRevision,
    semanticRevision: semanticViews.semanticRevision,
    viewCount: views.length,
    subjectCount: new Set(views.flatMap((view) => view.subject ?? [])).size,
    nodeCount: views.reduce((count, view) => count + view.nodeCount, 0),
    edgeCount: views.reduce((count, view) => count + view.edgeCount, 0),
    factCount: factIds.length,
    viewKindCounts: {
      architecture: views.filter((view) => view.viewKind === 'architecture').length,
      scenario: views.filter((view) => view.viewKind === 'scenario').length,
      state: views.filter((view) => view.viewKind === 'state').length
    },
    factIds,
    views
  };
}

function buildPathGroupSummaries<T, K extends string, S>(
  values: readonly T[],
  key: (value: T) => K,
  buildSummary: (group: K, values: readonly T[]) => S,
  sortKey: (summary: S) => string
): S[] {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const group = key(value);
    const groupValues = groups.get(group) ?? [];
    groupValues.push(value);
    groups.set(group, groupValues);
  }
  return [...groups]
    .map(([group, groupValues]) => buildSummary(group, groupValues))
    .sort((left, right) => compareCodeUnits(sortKey(left), sortKey(right)));
}

export function buildProvenanceSummary(provenance: ProvenanceFile): ReviewSummary['provenanceSummary'] {
  const originSummaries = buildPathGroupSummaries(
    provenance.artifacts, (a) => a.originType,
    (originType: ProvenanceOriginType, artifacts) => ({ originType, count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path)) }),
    (s) => s.originType
  );
  const overrideSummaries = buildPathGroupSummaries(
    provenance.artifacts, (a) => a.overrideStatus,
    (overrideStatus: OverrideStatus, artifacts) => ({ overrideStatus, count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path)) }),
    (s) => s.overrideStatus
  );
  const registryArtifacts = provenance.artifacts.filter((a) => a.registrySourceId);
  const registrySummaries = buildPathGroupSummaries(
    registryArtifacts, (a) => a.registrySourceId ?? '',
    (registrySourceId, artifacts) => ({
      registrySourceId,
      ...(artifacts[0].registryKind ? { registryKind: artifacts[0].registryKind } : {}),
      ...(artifacts[0].registryLocation ? { registryLocation: artifacts[0].registryLocation } : {}),
      count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path))
    }),
    (s) => s.registrySourceId
  );
  const generatedPassArtifacts = provenance.artifacts.filter((a) => a.generatedByPass);
  const generatedPassSummaries = buildPathGroupSummaries(
    generatedPassArtifacts, (a) => a.generatedByPass ?? '',
    (pass, artifacts) => ({ pass, count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path)) }),
    (s) => s.pass
  );
  const unverifiedArtifacts = provenance.artifacts.filter((a) => a.verifiedBy.length === 0);

  return {
    artifactCount: provenance.artifacts.length,
    verifiedArtifactCount: provenance.artifacts.length - unverifiedArtifacts.length,
    unverifiedArtifactCount: unverifiedArtifacts.length,
    overrideArtifactCount: countMatching(provenance.artifacts, (a) => a.overrideStatus !== 'none'),
    registryArtifactCount: registryArtifacts.length,
    generatedArtifactCount: generatedPassArtifacts.length,
    generatedPassCount: generatedPassSummaries.length,
    originSummaryCount: originSummaries.length, originSummaries,
    overrideSummaryCount: overrideSummaries.length, overrideSummaries,
    registrySummaryCount: registrySummaries.length, registrySummaries,
    generatedPassSummaries,
    unverifiedArtifacts: uniqueSorted(unverifiedArtifacts.map((a) => a.path))
  };
}
