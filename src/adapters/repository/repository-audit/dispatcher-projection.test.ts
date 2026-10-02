import { expect, test } from 'bun:test';

import { rawSha256 } from '../../../contracts/canonical.ts';
import {
  SEC_TCB_CLOSURE_RUNTIME_PATH,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH
} from '../../verification/platform/trust/contract/root.ts';
import type { SourceProgramFileInput } from '../source-program-model/contract.ts';
import { captureRepositoryAnalysisPolicy } from '../source-program-model/repository-analysis-policy.ts';
import {
  compileReviewedProcessDispatcherProjection,
  reviewedProcessDispatchersFromExactProjection
} from './cli.ts';

const runtimePath = 'src/fixture/runtime.ts';
const unrelatedPath = 'src/fixture/cli.ts';
const dispatchers = ['fixture:runtime:spawn', 'fixture:runtime:exec'];

function file(path: string, source: string): SourceProgramFileInput {
  return { path, source, contentDigest: rawSha256(source) };
}

function fixture() {
  // The analysis implementation is not a member of this runtime closure.
  // All values are ordinary fixture facts, never process authority.
  return {
    files: [
      file(runtimePath, 'fixture runtime'),
      file(SEC_TCB_CLOSURE_RUNTIME_PATH, 'fixture dispatcher recognition'),
      file(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, 'fixture bootstrap registry'),
      file(unrelatedPath, 'fixture CLI before')
    ],
    closure: {
      closure: new Set([runtimePath]),
      reviewedProcessDispatchers: new Set(dispatchers)
    }
  };
}

test('original projection producer retains its compiler input and round-trips through the exact consumer', () => {
  const { files, closure } = fixture();
  const projection = compileReviewedProcessDispatcherProjection(files, closure);
  expect(closure.closure.has(SEC_TCB_CLOSURE_RUNTIME_PATH)).toBe(false);
  expect(Object.keys(projection.inputDigests)).toEqual([
    SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, SEC_TCB_CLOSURE_RUNTIME_PATH, runtimePath
  ].sort());
  expect(projection.inputDigests[SEC_TCB_CLOSURE_RUNTIME_PATH])
    .toBe(rawSha256('fixture dispatcher recognition'));
  const consumed = reviewedProcessDispatchersFromExactProjection(files,
    JSON.parse(JSON.stringify(projection)));
  expect(consumed).toEqual([...dispatchers].sort());
  expect(captureRepositoryAnalysisPolicy(consumed!))
    .toEqual(captureRepositoryAnalysisPolicy(projection.reviewedProcessDispatchers));
  expect(Object.isFrozen(projection)).toBe(true);
  expect(Object.isFrozen(projection.inputDigests)).toBe(true);
});

test('unrelated candidate edits preserve the observed dispatcher analysis policy', () => {
  const { files, closure } = fixture();
  const projection = compileReviewedProcessDispatcherProjection(files, closure);
  const changed = files.map(input => input.path === unrelatedPath
    ? file(unrelatedPath, 'fixture CLI after') : input);
  expect(reviewedProcessDispatchersFromExactProjection(changed, projection))
    .toEqual(projection.reviewedProcessDispatchers);
  expect(compileReviewedProcessDispatcherProjection(changed, closure)).toEqual(projection);
});

test('exact consumer rejects missing required keys and changed compiler or registry bytes', () => {
  const { files, closure } = fixture();
  const projection = compileReviewedProcessDispatcherProjection(files, closure);
  for (const required of [SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH]) {
    const inputDigests = { ...projection.inputDigests };
    delete inputDigests[required];
    expect(reviewedProcessDispatchersFromExactProjection(files, { ...projection, inputDigests })).toBeNull();
    expect(reviewedProcessDispatchersFromExactProjection(files, {
      ...projection, inputDigests: { ...projection.inputDigests, [required]: rawSha256('foreign bytes') }
    })).toBeNull();
    const changed = files.map(input => input.path === required ? file(required, 'changed actual source') : input);
    expect(reviewedProcessDispatchersFromExactProjection(changed, projection)).toBeNull();
    expect(reviewedProcessDispatchersFromExactProjection(files.filter(input => input.path !== required), projection)).toBeNull();
  }
  expect(reviewedProcessDispatchersFromExactProjection(files, null)).toBeNull();
});

test('producer refuses a missing exact compiler input instead of inventing a cache identity', () => {
  const { files, closure } = fixture();
  for (const required of [SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, runtimePath]) {
    expect(() => compileReviewedProcessDispatcherProjection(files.filter(input => input.path !== required), closure))
      .toThrow(`TCB reviewed process projection input is absent from the exact census: ${required}`);
  }
});

test('compiler already reachable in the runtime closure is captured once without cache self-reference', () => {
  const { files, closure } = fixture();
  const projection = compileReviewedProcessDispatcherProjection(files, {
    ...closure, closure: new Set([...closure.closure, SEC_TCB_CLOSURE_RUNTIME_PATH])
  });
  expect(Object.keys(projection.inputDigests)).toHaveLength(3);
  expect(reviewedProcessDispatchersFromExactProjection(files, projection)).toEqual([...dispatchers].sort());
});
