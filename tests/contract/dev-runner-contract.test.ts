import { describe, expect, test } from 'bun:test';

import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

describe('dev-runner entrypoint contract', () => {
  test('root package routes developer feedback through canonical runner commands', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts.dev).toBe('bun ./platform/dev-runner.ts');
    expect(scripts.typecheck).toBe('bun ./platform/dev-runner.ts typecheck');
    expect(scripts.test).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:affected']).toBe('bun ./platform/dev-runner.ts test:affected');
    expect(scripts['test:fast']).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:slow']).toBe('bun ./platform/dev-runner.ts test:slow');
    expect(scripts['test:full']).toBe('bun ./platform/dev-runner.ts test');
    expect(scripts.check).toBe('bun run check:fast');
    expect(scripts['check:affected']).toBe('bun ./platform/dev-runner.ts check:affected');
    expect(scripts['check:fast']).toBe('bun ./platform/dev-runner.ts check:fast');
    expect(scripts['check:full']).toBe(
      'bun run imports:check --all && bun run typecheck && bun run docs:doctor && bun run test:full'
    );
    expect(scripts['generated-state:inspect']).toBe(
      'bun ./platform/dev-runner.ts generated-state:inspect'
    );
    expect(scripts['generated-state:plan']).toBe(
      'bun ./platform/dev-runner.ts generated-state:plan'
    );
    expect(scripts['generated-state:cleanup']).toBe(
      'bun ./platform/dev-runner.ts generated-state:cleanup'
    );
    expect(scripts['workspace:settle']).toBe(
      'bun ./platform/dev-runner.ts environment:workspace-settle'
    );
    expect(scripts['workspace:settle:fix']).toBe(
      'bun ./platform/dev-runner.ts environment:workspace-settle --fix'
    );
    expect(scripts['test:watch']).toBeUndefined();
    expect(scripts['test:coverage']).toBeUndefined();
    expect(scripts['imports:check']).toBe('bun ./platform/dev-runner.ts imports:check');
    expect(scripts['imports:apply']).toBe('bun ./platform/dev-runner.ts imports:apply');
    expect(scripts['imports:freeze']).toBe('bun ./platform/dev-runner.ts imports:freeze');
    expect(scripts['imports:transform']).toBeUndefined();
    expect(scripts['imports:remove-unused']).toBeUndefined();
    expect(scripts['imports:staged']).toBeUndefined();
    expect(scripts['deps:ensure']).toBe('bun ./platform/dev-runner.ts deps:ensure');
    expect(scripts['imports:prepare']).toBeUndefined();
    expect(scripts['imports:organize']).toBeUndefined();
  });
});
