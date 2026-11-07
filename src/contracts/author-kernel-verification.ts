import { isPlainObject, uniqueSorted } from './canonical.ts';
import { parseExactJson } from './exact-json.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from './repository-path.ts';

/** Input discovery for the existing Cargo/native verification methods. These
 * are source observations, never Rust semantics or execution qualification. */
export const AUTHOR_KERNEL_ROOT = 'crates/gift-author-kernel';
export const AUTHOR_KERNEL_GRAMMAR_MANIFEST = 'schema/author/first-layer/codec-parameters.json';
export const AUTHOR_KERNEL_LOCK_SCHEMA = 'schema/source/binding-lock-1.schema.json';
export const AUTHOR_KERNEL_READER_CHECK = `${AUTHOR_KERNEL_ROOT}/tests/reader-check.ts`;
export const AUTHOR_KERNEL_TARGET_CHECK = `${AUTHOR_KERNEL_ROOT}/tests/target-check.ts`;

const READER_ORACLE_INPUTS = new Set([
  'tools/documentation/codec_parameters.py',
  'tools/documentation/source_inventory.py'
]);

/** Proactive roots only. The grammar's declared resources are discovered from
 * its exact manifest bytes, including resources outside these directories. */
export function isAuthorKernelVerificationRootInput(repositoryPath: string): boolean {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(repositoryPath)) return false;
  if (repositoryPath === AUTHOR_KERNEL_GRAMMAR_MANIFEST
      || repositoryPath === AUTHOR_KERNEL_LOCK_SCHEMA
      || repositoryPath === AUTHOR_KERNEL_READER_CHECK
      || repositoryPath === AUTHOR_KERNEL_TARGET_CHECK
      || READER_ORACLE_INPUTS.has(repositoryPath)) return true;
  if (/^examples\/第一层作者\/names-and-roots\/[^/]+\.json$/u.test(repositoryPath)) return true;
  if (/^(?:crates\/(?:gift-author-kernel\/)?)?(?:Cargo\.(?:toml|lock)|\.cargo\/config(?:\.toml)?|rust-toolchain(?:\.toml)?)$/u.test(repositoryPath)) return true;
  if (!repositoryPath.startsWith(`${AUTHOR_KERNEL_ROOT}/`)) return false;
  const localPath = repositoryPath.slice(AUTHOR_KERNEL_ROOT.length + 1);
  return localPath === 'Cargo.toml' || localPath === 'Cargo.lock' || localPath === 'build.rs'
    || /^(?:src|tests|benches|examples)\/.+\.rs$/u.test(localPath)
    || /^fixtures\/.+\.json$/u.test(localPath);
}

/** Standalone Bun programs are native method inputs, not bun:test modules. */
export function isAuthorKernelVerificationProgram(repositoryPath: string): boolean {
  return repositoryPath === AUTHOR_KERNEL_READER_CHECK || repositoryPath === AUTHOR_KERNEL_TARGET_CHECK;
}

export class AuthorKernelInputDeclarationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthorKernelInputDeclarationError';
  }
}

/** Reads only the existing build script's declared resource locations. The
 * original Reader/Python codec still owns grammar interpretation. */
export function authorKernelDeclaredInputPaths(source: string): readonly string[] {
  let value: unknown;
  try {
    value = parseExactJson(source, 'Author kernel grammar input manifest', {
      rootObjectKeys: ['schema', 'scope', 'resources', 'externals', 'extensions']
    });
  } catch (cause) {
    throw new AuthorKernelInputDeclarationError('Author kernel grammar input manifest is invalid.', { cause });
  }
  if (!isPlainObject(value)
      || value.schema !== 'gift.design-codec-parameters/2'
      || value.scope !== 'complete-candidate-structure-only'
      || !Array.isArray(value.resources) || !Array.isArray(value.externals)) {
    throw new AuthorKernelInputDeclarationError('Author kernel grammar input declaration is unsupported.');
  }
  const paths: string[] = [AUTHOR_KERNEL_GRAMMAR_MANIFEST];
  for (const resource of [...value.resources, ...value.externals]) {
    if (!isPlainObject(resource) || !CodexDevelopmentIsCanonicalRepositoryPath(resource.path)) {
      throw new AuthorKernelInputDeclarationError('Author kernel grammar input path is not canonical repository-relative.');
    }
    paths.push(resource.path);
  }
  return Object.freeze(uniqueSorted(paths));
}
