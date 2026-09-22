import { describe, expect, test } from 'bun:test';

import { projectBlockUsageMap } from '../../src/application/block-usage-map.ts';
import { formatBlockUsageMap } from '../../src/entry/cli/block-usage-map.ts';

describe('block usage map presentation boundary', () => {
  test('application owns deterministic installation ordering and entry only renders it', () => {
    const source = {
      blocks: [
        { id: 'z/late', installOrder: 2 },
        { id: 'z/first', installOrder: 1 },
        { id: 'a/first', installOrder: 1 }
      ]
    };
    const view = projectBlockUsageMap(source);
    expect(view).toEqual({
      blocks: [
        { id: 'a/first', installOrder: 1 },
        { id: 'z/first', installOrder: 1 },
        { id: 'z/late', installOrder: 2 }
      ]
    });
    expect(source.blocks.map((block) => block.id)).toEqual(['z/late', 'z/first', 'a/first']);
    expect(formatBlockUsageMap(view)).toBe([
      'Block usage map 3 blocks',
      'Install order: 1:a/first, 1:z/first, 2:z/late'
    ].join('\n'));
  });
});
