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
    const text = formatBlockUsageMap(view);
    expect(text).toMatch(/Block usage map\s+3\s+blocks\b/u);
    expect(text).toMatch(
      /Install order[^\n]*[\s:,;]1:a\/first(?=$|[\s;,])[^\n]*[\s:,;]1:z\/first(?=$|[\s;,])[^\n]*[\s:,;]2:z\/late(?=$|[\s;,])/u
    );
  });
});
