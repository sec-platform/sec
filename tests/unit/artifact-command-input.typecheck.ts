import { parseArtifactCommandInput } from '../../src/bootstrap/cli/artifact-command-input.ts';
import { verificationLaneProfile, type VerificationLane } from '../../src/assurance/verification/contract/lanes.ts';

function inputContract() {
  const input = parseArtifactCommandInput(undefined, {});
  if (input.kind === 'paths') {
    const filter: 'governance' | 'test' | 'contract' | undefined = input.filter;
    void filter;
    // @ts-expect-error The captured filter is immutable.
    input.filter = 'test';
  } else {
    // @ts-expect-error Neither generation nor manifest inspection owns a path filter.
    input.filter;
  }
  // @ts-expect-error Selected output is immutable.
  input.output.json = true;
  const lane: VerificationLane = 'all';
  const selection = verificationLaneProfile(lane);
  // @ts-expect-error Callers cannot alter the canonical runtime selection.
  selection.runtimeMode = 'service';
  // @ts-expect-error A projection is not proof of successful execution.
  selection.passed;
}
void inputContract;
