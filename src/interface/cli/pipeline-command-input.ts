import { parseVerificationLaneOption } from './verification-lane-option.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { parseJsonOutputOptions, type JsonOutputIssue } from './json-output-options.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../../compiler/pipeline/stages.ts';

function pipelineStage(value: unknown, option: string): PipelineStageId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !PIPELINE_STAGE_IDS.includes(value as PipelineStageId)) {
    throw new CompilerError('PIPELINE-USAGE-001', `${option} must be one of: ${PIPELINE_STAGE_IDS.join(', ')}`);
  }
  return value as PipelineStageId;
}

export const PIPELINE_COMPILE_DEFAULT_LANE = 'all' as const;

export function rejectPipelineOutputIssue(issue: JsonOutputIssue): never {
  throw new CompilerError('PIPELINE-USAGE-003', issue.message);
}

/** Decode only command-owned fields before loading an execution domain. */
export function parsePipelineOutputOptions(options: Readonly<Record<string, unknown>>) {
  return parseJsonOutputOptions(options, rejectPipelineOutputIssue);
}

/** Capture the invocation once; no coercion hooks or mutable CLI object crosses an await. */
export function parsePipelineCompileOptions(options: Readonly<Record<string, unknown>>) {
  const { json, compact, from, through, lane } = options;
  const output = parsePipelineOutputOptions({ json, compact });
  const first = pipelineStage(from, '--from');
  const last = pipelineStage(through, '--through');
  return Object.freeze({
    output,
    invocation: Object.freeze({
      source: 'cli' as const,
      ...(first === undefined ? {} : { from: first }),
      ...(last === undefined ? {} : { through: last }),
      verificationLane: parseVerificationLaneOption(lane, (choices) => {
        throw new CompilerError('PIPELINE-USAGE-002', `--lane must be ${choices}`);
      })
    })
  });
}
