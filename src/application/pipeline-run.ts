import type { VerificationReport } from '../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../assurance/verification/review/contract/types.ts';
import type { LockFile, PlanFile } from '../compiler/contract.ts';
import type { PipelineSemanticContext } from '../compiler/pipeline/semantic-context.ts';
import type { PipelineStageId } from '../compiler/pipeline/stages.ts';
import type { ExplainGraph } from '../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../semantics/provenance/types.ts';

export interface PipelineEmitResult {
  readonly lock: LockFile;
  readonly provenance: ProvenanceFile;
  readonly graph: ExplainGraph;
  readonly reviewSummary: ReviewSummary;
}

export interface PipelineUseCaseOperations {
  readonly beforeStage: (stage: PipelineStageId) => void | Promise<void>;
  readonly resolve: () => Promise<{ readonly plan: PlanFile }>;
  readonly semantic: () => Promise<PipelineSemanticContext>;
  readonly compose: () => Promise<{ readonly plan: PlanFile }>;
  readonly verify: () => Promise<{ readonly report: VerificationReport }>;
  readonly lock: () => Promise<void>;
  readonly emit: () => Promise<PipelineEmitResult>;
}

export interface PipelineUseCaseResult {
  readonly completedStages: readonly PipelineStageId[];
  readonly semanticContext?: PipelineSemanticContext;
  readonly plan?: PlanFile;
  readonly verificationReport?: VerificationReport;
  readonly emittedLock?: LockFile;
  readonly emittedProvenance?: ProvenanceFile;
  readonly explainGraph?: ExplainGraph;
  readonly reviewSummary?: ReviewSummary;
}

/**
 * Coordinate one already-admitted pipeline use case. This layer owns stage
 * ordering, fail-stop behavior and result projection; injected operations own
 * leases, journals, workspace I/O and target-tool effects. A stage is recorded
 * completed only after its operation resolves successfully.
 */
export async function coordinatePipelineStages(
  stages: readonly PipelineStageId[],
  operations: PipelineUseCaseOperations
): Promise<PipelineUseCaseResult> {
  let plan: PlanFile | undefined;
  let semanticContext: PipelineSemanticContext | undefined;
  let verificationReport: VerificationReport | undefined;
  let emittedLock: LockFile | undefined;
  let emittedProvenance: ProvenanceFile | undefined;
  let explainGraph: ExplainGraph | undefined;
  let reviewSummary: ReviewSummary | undefined;
  const completedStages: PipelineStageId[] = [];
  const selectedStages = [...stages];
  const selectedOperations = new Map<PipelineStageId, PipelineUseCaseOperations[PipelineStageId]>();
  const invoke = <Stage extends PipelineStageId>(stage: Stage): ReturnType<PipelineUseCaseOperations[Stage]> =>
    Reflect.apply(selectedOperations.get(stage)!, operations, []) as ReturnType<PipelineUseCaseOperations[Stage]>;

  const executeStage: Readonly<Record<PipelineStageId, () => Promise<void>>> = Object.freeze({
    resolve: async () => { plan = (await invoke('resolve')).plan; },
    semantic: async () => { semanticContext = await invoke('semantic'); },
    compose: async () => { plan = (await invoke('compose')).plan; },
    verify: async () => { verificationReport = (await invoke('verify')).report; },
    lock: async () => { await invoke('lock'); },
    emit: async () => {
      const result = await invoke('emit');
      emittedLock = result.lock;
      emittedProvenance = result.provenance;
      explainGraph = result.graph;
      reviewSummary = result.reviewSummary;
    }
  });

  // Bind the admitted schedule and only its selected ports before the first
  // callback or suspension. A hook cannot append work or replace later methods.
  for (const stage of selectedStages) {
    if (!Object.hasOwn(executeStage, stage)) throw new TypeError(`Unknown pipeline stage: ${String(stage)}`);
  }
  for (const stage of selectedStages) {
    if (selectedOperations.has(stage)) continue;
    const operation = operations[stage];
    if (typeof operation !== 'function') throw new TypeError(`Pipeline ${stage} operation must be callable`);
    selectedOperations.set(stage, operation);
  }
  const beforeStage = selectedStages.length === 0 ? undefined : operations.beforeStage;
  if (selectedStages.length > 0 && typeof beforeStage !== 'function') {
    throw new TypeError('Pipeline beforeStage operation must be callable');
  }
  for (const stage of selectedStages) {
    await beforeStage!.call(operations, stage);
    await executeStage[stage]();
    completedStages.push(stage);
  }

  return {
    completedStages: Object.freeze(completedStages.slice()),
    ...(semanticContext ? { semanticContext } : {}),
    ...(plan ? { plan } : {}),
    ...(verificationReport ? { verificationReport } : {}),
    ...(emittedLock ? { emittedLock } : {}),
    ...(emittedProvenance ? { emittedProvenance } : {}),
    ...(explainGraph ? { explainGraph } : {}),
    ...(reviewSummary ? { reviewSummary } : {})
  };
}
