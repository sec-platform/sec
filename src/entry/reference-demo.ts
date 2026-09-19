import {
  isReferenceDemoMode,
  type ReferenceDemoMode
} from '../application/reference-demo.ts';

const REFERENCE_DEMO_USAGE =
  'Usage: bun src/bootstrap/reference/demo.ts <quickstart|governance|closed-loop>';

export function readReferenceDemoMode(
  argv: readonly string[] = process.argv
): ReferenceDemoMode {
  const value = argv[2];
  if (isReferenceDemoMode(value)) return value;
  throw new Error(REFERENCE_DEMO_USAGE);
}

export function announceReferenceDemoWorkspace(workspaceRoot: string): void {
  console.log(`Reference demo: isolated workspace ${workspaceRoot}`);
}
