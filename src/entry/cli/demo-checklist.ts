import type { DemoChecklist } from '../../application/demo-checklist.ts';
import { formatFields } from './format-utils.ts';

export function formatDemoChecklist(checklist: DemoChecklist): string {
  return [
    formatFields([
      `Demo checklist ${checklist.status}`,
      `items=${checklist.itemCount}`,
      `missing=${checklist.missingCount}`
    ]),
    ...checklist.items.map((item) => formatFields([
      `${item.id}: ${item.status}`,
      item.artifactPath,
      `command=${item.command}`
    ])),
    `Next command: ${checklist.nextCommand}`
  ].join('\n');
}
