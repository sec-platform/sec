import type { ExplainGraph } from '../shared/explain-types.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { withPipelineTransaction } from '../shared/pipeline-kernel.ts';
import {
  PIPELINE_STAGE_IDS,
  type PipelineEventHandler,
  type PipelineSource,
  type PipelineStageId
} from '../shared/pipeline-types.ts';
import type { PlanFile } from '../shared/plan-manifest-types.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';
import { resolveWorkspace } from './block-orchestrator.ts';
import { adaptWorkspace, composeWorkspace } from './compose-orchestrator.ts';
import { explainWorkspace, lockWorkspace } from './emit-orchestrator.ts';
import { verifyWorkspace } from './verify-orchestrator.ts';
import { applyWorkbenchMutations } from './workbench-orchestrator.ts';

export interface CompileWorkspaceOptions {
  source?: PipelineSource;
  from?: PipelineStageId;
  through?: PipelineStageId;
  verificationLane?: VerificationLane;
  applyWorkbenchMutations?: boolean;
  onEvent?: PipelineEventHandler;
}

export interface CompileWorkspaceResult {
  transactionId: string;
  completedStages: PipelineStageId[];
  plan?: PlanFile;
  lock: LockFile;
  verificationReport?: VerificationReport;
  explainGraph?: ExplainGraph;
  reviewSummary?: ReviewSummary;
}

function selectStages(options: CompileWorkspaceOptions): PipelineStageId[] {
  const fromIndex = options.from ? PIPELINE_STAGE_IDS.indexOf(options.from) : 0;
  const throughIndex = options.through
    ? PIPELINE_STAGE_IDS.indexOf(options.through)
    : PIPELINE_STAGE_IDS.length - 1;

  if (fromIndex < 0 || throughIndex < 0 || fromIndex > throughIndex) {
    throw new Error(`Invalid pipeline stage range: ${options.from ?? PIPELINE_STAGE_IDS[0]} -> ${options.through ?? PIPELINE_STAGE_IDS.at(-1)}`);
  }
  return PIPELINE_STAGE_IDS.slice(fromIndex, throughIndex + 1);
}

export async function compileWorkspace(
  workspaceRoot = process.cwd(),
  options: CompileWorkspaceOptions = {}
): Promise<CompileWorkspaceResult> {
  const stages = selectStages(options);
  if (options.applyWorkbenchMutations && !stages.includes('resolve')) {
    throw new Error('Workbench mutations require a pipeline range that includes resolve');
  }

  return withPipelineTransaction(
    workspaceRoot,
    options.source ?? 'api',
    stages,
    options.onEvent,
    async (context) => {
      if (options.applyWorkbenchMutations) {
        await applyWorkbenchMutations(workspaceRoot);
      }

      let plan: PlanFile | undefined;
      let verificationReport: VerificationReport | undefined;
      let explainGraph: ExplainGraph | undefined;
      let reviewSummary: ReviewSummary | undefined;
      const completedStages: PipelineStageId[] = [];

      for (const stage of stages) {
        if (stage === 'resolve') {
          const result = await resolveWorkspace(workspaceRoot, context);
          plan = result.plan;
        } else if (stage === 'compose') {
          const result = await composeWorkspace(workspaceRoot, undefined, context);
          plan = result.plan;
        } else if (stage === 'adapt') {
          const result = await adaptWorkspace(workspaceRoot, context);
          plan = result.plan;
        } else if (stage === 'verify') {
          const result = await verifyWorkspace(
            workspaceRoot,
            { lane: options.verificationLane ?? 'all' },
            context
          );
          verificationReport = result.report;
        } else if (stage === 'lock') {
          await lockWorkspace(workspaceRoot, context);
        } else if (stage === 'emit') {
          const result = await explainWorkspace(workspaceRoot, context);
          explainGraph = result.graph;
          reviewSummary = result.reviewSummary;
        }
        completedStages.push(stage);
      }

      const lock = await readLockFile(workspaceRoot);
      return {
        transactionId: context.transactionId,
        completedStages,
        ...(plan ? { plan } : {}),
        lock,
        ...(verificationReport ? { verificationReport } : {}),
        ...(explainGraph ? { explainGraph } : {}),
        ...(reviewSummary ? { reviewSummary } : {})
      };
    }
  );
}
