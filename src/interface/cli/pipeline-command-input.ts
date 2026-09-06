import { captureCliOptions } from './own-options.ts';
import { parseVerificationLaneOption } from './verification-lane-option.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { parseJsonOutputOptions, type JsonOutputIssue } from './json-output-options.ts';
import { selectPipelineStageRange, PIPELINE_DEFAULT_VERIFICATION_LANE } from '../../compiler/pipeline/invocation.ts';

export const PIPELINE_COMPILE_DEFAULT_LANE = PIPELINE_DEFAULT_VERIFICATION_LANE;

export function rejectPipelineOutputIssue(issue: JsonOutputIssue): never {
  throw new CompilerError('PIPELINE-USAGE-003', issue.message);
}

/** Decode only command-owned fields before loading an execution domain. */
export function parsePipelineOutputOptions(options: Readonly<Record<string, unknown>>) {
  return parseJsonOutputOptions(options, rejectPipelineOutputIssue);
}

/** Capture the invocation once; no coercion hooks or mutable CLI object crosses an await. */
export function parsePipelineCompileOptions(options: Readonly<Record<string, unknown>>) {
  const { json, compact, from, through, lane } = captureCliOptions(options, ['json', 'compact', 'from', 'through', 'lane'].map((name) => ({ name, scope: 'property' as const })));
  const output = parsePipelineOutputOptions({ json, compact });
  const { from: first, through: last } = selectPipelineStageRange(from, through);
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
