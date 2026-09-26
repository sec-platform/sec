/**
 * GitHub Codex review presentation adapter.
 *
 * Provider-owned prose is parsed only here. The generic Review contract never
 * imports or depends on Codex trigger/help text.
 */

export const CODEX_CLEAN_REVIEW_VERDICT_PREFIX =
  "Codex Review: Didn't find any major issues." as const;

export const CODEX_CLEAN_REVIEW_CONGRATULATIONS = Object.freeze([
  'Bravo.',
  'Delightful!',
  'Swish!',
  'What shall we build next?',
  'You’re on a roll!',
  'Chef’s kiss.',
  '🚀'
] as const);

export const CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES = Object.freeze([
  '<details> <summary>ℹ️ About Codex in GitHub</summary>',
  '<br/>',
  '[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you',
  '- Open a pull request for review',
  '- Mark a draft as ready',
  '- Comment "@codex review".',
  'If Codex has suggestions, it will comment; otherwise it will react with 👍.',
  'Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".',
  '</details>'
] as const);

export function isCodexCleanReviewVerdict(firstLine: unknown): boolean {
  if (typeof firstLine !== 'string') return false;
  if (firstLine === CODEX_CLEAN_REVIEW_VERDICT_PREFIX) return true;
  const prefix = `${CODEX_CLEAN_REVIEW_VERDICT_PREFIX} `;
  if (!firstLine.startsWith(prefix)) return false;
  const congratulation = firstLine.slice(prefix.length);
  return CODEX_CLEAN_REVIEW_CONGRATULATIONS.some((candidate) => candidate === congratulation);
}

export function isCodexCleanReviewAboutBlock(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const semanticLines = value.replaceAll('\r\n', '\n').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return semanticLines.length === CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES.length
    && semanticLines.every((line, index) => line === CODEX_CLEAN_REVIEW_ABOUT_NONEMPTY_LINES[index]);
}
