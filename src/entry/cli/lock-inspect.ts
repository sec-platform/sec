import type { LockInspectView } from '../../application/lock-inspect.ts';
import { formatCounts, formatFields, formatList } from './format-utils.ts';

export function formatLockInspect(view: LockInspectView): string {
  return [
    `Graph lock ${view.appName}`,
    formatFields([
      `stack=${view.stack}`,
      `mode=${view.mode}`,
      `blocks=${view.blockCount}`,
      `generated=${view.generatedCount}`,
      `acceptance=${view.acceptanceCount}`
    ]),
    `Block order: ${formatList([...view.blockOrder])}`,
    `Pass status: ${formatCounts([...view.passStates])}`
  ].join('\n');
}
