import type { PassStatus } from '../../src/compiler/contract/pass-status.ts';
import { PASS_STATUS_PENDING } from '../../src/adapters/compilation/pipeline/defaults.ts';
import type { PipelineSettlementFailure } from '../../src/application/pipeline-failure.ts';
import { PIPELINE_STAGE_DEFINITIONS } from '../../src/compiler/pipeline/stage-definitions.ts';
import { commandValue } from '../../src/entry/cli/command-value.ts';
import { captureCliOptions } from '../../src/entry/cli/own-options.ts';

function contracts(failure: PipelineSettlementFailure) {
  const { 'build-ir': _, ...legacy } = PASS_STATUS_PENDING;
  const admissible: PassStatus = legacy;
  void admissible;
  // @ts-expect-error Only the explicitly retained build-ir field is optional.
  const invalid: PassStatus = { parse: 'pending' };
  void invalid;
  // @ts-expect-error Compiled policy relations are not mutable arrays.
  PIPELINE_STAGE_DEFINITIONS.compose.requires.push('repair');
  const fields = captureCliOptions({ flag: true }, [{ name: 'flag', scope: 'property' }]);
  // @ts-expect-error Capture does not validate the field's semantic type.
  const flag: boolean = fields.flag;
  void flag;
  // @ts-expect-error Capture projects only declared fields.
  fields.unowned;
  // @ts-expect-error Captured fields are immutable.
  fields.flag = false;
  // @ts-expect-error Formatter must accept its paired value.
  commandValue(7, (text: string) => text.toUpperCase());
  // @ts-expect-error Collected settlement failures cannot be amended in place.
  failure.settlementFailures.push({ operation: 'forged', reason: null });
}
void contracts;
