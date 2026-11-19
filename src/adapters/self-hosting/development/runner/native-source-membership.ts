import path from 'node:path';

import { AUTHOR_KERNEL_ROOT, isAuthorKernelRuleSource } from '../../../../contracts/author-kernel-verification.ts';
import { AUTHOR_NATIVE_METHOD_IDS, type AuthorNativeMethodUnit } from '../../../../contracts/author-native-methods.ts';
import { compareCodeUnits } from '../../../../contracts/canonical.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';
import {
  inspectNoFollowDirectoryChain,
  scanNoFollowDirectoryTreeMetadata
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

export type NativeMethodRequest = Pick<AuthorNativeMethodUnit, 'id' | 'inputClosureDigest'>;

/** Select from the already issued catalog; caller DTOs carry selectors only.
 * This pure projection does not issue or authenticate a catalog itself. */
export function selectNativeExecutionMethods(
  issued: readonly AuthorNativeMethodUnit[], requested: readonly NativeMethodRequest[]
): readonly AuthorNativeMethodUnit[] {
  const selected = new Map<AuthorNativeMethodUnit['id'], AuthorNativeMethodUnit>();
  for (const request of requested) {
    const original = issued.find(method => method.id === request.id);
    if (original === undefined || original.inputClosureDigest !== request.inputClosureDigest
        || original.unresolvedInputs.length !== 0) {
      throw new CodedFailure('NATIVE-TEST-SOURCE', 'Selected native method does not match a complete issued source closure');
    }
    selected.set(original.id, original);
  }
  return Object.freeze(AUTHOR_NATIVE_METHOD_IDS.flatMap(id => {
    const method = selected.get(id);
    return method === undefined ? [] : [method];
  }));
}

/** A pre-execution observation, not a sealed namespace or new source issuer.
 * The caller retains original input pins and an armed namespace observer. */
export function assertNativeRuleSourceMembership(input: Readonly<{
  repositoryRoot: string;
  issuedInputPaths: readonly string[];
  deadlineAtMs: number;
  maximumEntries: number;
  signal?: AbortSignal;
}>): void {
  const root = inspectNoFollowDirectoryChain(
    path.join(input.repositoryRoot, AUTHOR_KERNEL_ROOT, 'src'), 'Native Rust source root'
  ).target;
  const entries = scanNoFollowDirectoryTreeMetadata(root, {
    deadlineAtMs: input.deadlineAtMs,
    maximumEntries: input.maximumEntries,
    signal: input.signal
  });
  const expected = new Set(input.issuedInputPaths.filter(isAuthorKernelRuleSource));
  const actual = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'link') {
      throw new CodedFailure('NATIVE-TEST-SOURCE', `Native Rust source domain contains a link: ${entry.relativePath}`);
    }
    const sourcePath = `${AUTHOR_KERNEL_ROOT}/src/${entry.relativePath}`;
    if (entry.kind === 'file' && sourcePath.endsWith('.rs')) {
      if (!isAuthorKernelRuleSource(sourcePath)) {
        throw new CodedFailure('NATIVE-TEST-SOURCE', `Native Rust source path cannot be represented by issued inputs: ${entry.relativePath}`);
      }
      actual.add(sourcePath);
    }
  }
  const missing = [...expected].filter(sourcePath => !actual.has(sourcePath)).sort(compareCodeUnits);
  const extra = [...actual].filter(sourcePath => !expected.has(sourcePath)).sort(compareCodeUnits);
  if (missing.length > 0 || extra.length > 0) {
    throw new CodedFailure('NATIVE-TEST-SOURCE',
      `Native Rust source membership differs from issued inputs: ${JSON.stringify({ missing, extra })}`);
  }
}
