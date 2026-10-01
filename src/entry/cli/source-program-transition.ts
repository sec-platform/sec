import {
  runSourceProgramTransition,
  type SourceProgramTransitionControl,
  type SourceProgramTransitionInspectionPorts,
  type SourceProgramTransitionRequest
} from '../../application/source-program-transition.ts';

export interface SourceProgramTransitionCliBindings<Facts> {
  prepare(argv: readonly string[]): Promise<Readonly<{
    request: SourceProgramTransitionRequest;
    control: SourceProgramTransitionControl;
    ports: SourceProgramTransitionInspectionPorts<Facts>;
  }>>;
  encode(facts: Facts): string;
  write(output: string): void;
}

/** CLI transport shares the business entry; complete conditional facts are
 * observable data even when their later adoption still has blockers. */
export async function runSourceProgramTransitionCli<Facts>(
  argv: readonly string[],
  bindings: SourceProgramTransitionCliBindings<Facts>
): Promise<void> {
  const prepared = await bindings.prepare(argv);
  const result = await runSourceProgramTransition(prepared.request, prepared.control, prepared.ports);
  if (result.source?.kind === 'complete' && result.status === 'observed') {
    bindings.write(bindings.encode(result.source.facts));
    return;
  }
  if (result.failures.length === 1) throw result.failures[0]!.cause;
  if (result.failures.length > 1) throw new AggregateError(result.failures.map(({ cause }) => cause),
    'Source transition owners failed');
  throw new Error(`Source transition did not complete: ${result.status}`);
}
