import type { ErrorProtocol } from '../../compiler/error-protocol.ts';
import { formatCompilerFailure, inspectFailureValue } from '../../compiler/errors.ts';
import { formatJson } from './format-utils.ts';

type FailurePresentation = Readonly<{
  write: (line: string) => void;
  error: (line: string) => string;
  dim: (line: string) => string;
}>;

/** Presentation has no control-flow authority: preserve terminal failure even if it fails. */
export function reportCliFailure(
  error: unknown,
  buildProtocol: (error: unknown) => ErrorProtocol,
  presentation: FailurePresentation
): void {
  const emit = (line: string, style: 'error' | 'dim') => {
    let rendered = line;
    try { const styled = presentation[style](line); if (typeof styled === 'string') rendered = styled; } catch { /* Fall back to undecorated text. */ }
    try { presentation.write(rendered); } catch { /* A broken sink cannot change the primary failure. */ }
  };
  try {
    const protocol = buildProtocol(error);
    emit(`${protocol.code} ${protocol.message}`, 'error');
    emit(formatJson({ code: protocol.code, message: protocol.message, recoverable: protocol.recoverable,
      issueType: protocol.issueType, suggestedActions: protocol.suggestedActions, artifactPaths: protocol.artifactPaths },
    { compact: true }), 'dim');
    const details = protocol.details;
    if (details) {
      let rendered: string;
      try {
        rendered = formatJson(details, { compact: false });
      }
      catch { rendered = `[Details could not be rendered as JSON]\n${inspectFailureValue(details)}`; }
      emit(rendered, 'dim');
    }
  } catch {
    emit(`[Failure protocol could not be rendered]\n${formatCompilerFailure(error)}`, 'error');
  }
}
