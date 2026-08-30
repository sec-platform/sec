import { ensureCurrentTrustedRuntimeMainHealth } from '../../src/control/branch-lifecycle/trusted-runtime-closeout.ts';

const [repositoryRoot, repository, defaultBranch] = process.argv.slice(2);
if (!repositoryRoot || !repository || !defaultBranch) {
  throw new Error('trusted runtime MainHealth child requires repositoryRoot, repository, and defaultBranch');
}

globalThis.fetch = async () => {
  throw new Error('REST must not run before credential admission');
};

await ensureCurrentTrustedRuntimeMainHealth({
  repositoryRoot,
  repository,
  defaultBranch
});
