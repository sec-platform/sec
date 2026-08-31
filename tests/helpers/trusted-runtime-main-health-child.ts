import { ensureCurrentTrustedRuntimeMainHealth } from '../../src/control/branch-lifecycle/trusted-runtime-closeout.ts';

const [repositoryRoot, repository, defaultBranch] = process.argv.slice(2);
if (!repositoryRoot || !repository || !defaultBranch) {
  throw new Error('trusted runtime MainHealth child requires repositoryRoot, repository, and defaultBranch');
}

globalThis.fetch = Object.assign(
  async (): Promise<Response> => {
    throw new Error('REST must not run before credential admission');
  },
  { preconnect: globalThis.fetch.preconnect.bind(globalThis.fetch) }
);

await ensureCurrentTrustedRuntimeMainHealth({
  repositoryRoot,
  repository,
  defaultBranch
});
