---
schema: codex-development-work-package-v1
id: git-hook-executable-fence
tracking: none
base: df67ffc7ddf0bf7fae369c8b51fa5a0c5efb40bb
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: close-git-hook-executable-verification-bypass
    owner: development-hooks-owner
    ownedPaths:
      - config/repository/work-packages/git-hook-executable-fence.md
      - src/adapters/self-hosting/development/hooks/install.ts
      - tests/e2e/install-git-hooks.test.ts
forbiddenPaths:
  - .github/
  - .documentation/
  - AGENTS.md
  - docs/
  - package.json
  - bun.lock
acceptance:
  - every hook-installer raw Git child execution is fenced by the retained canonical Git executable identity
  - callers cannot disable executable identity verification for read or config-effect operations
  - an invalid executable fence prevents every git-read and git-config child process
  - existing same-path mutation protection remains in force before config effects
tests:
  - tests/e2e/install-git-hooks.test.ts
---

# Git hook executable fence

The hook installer borrows one retained GitRead provider but executes its own synchronous Git child processes.
The retained executable identity must therefore be verified by the hook owner before every raw child execution;
the fact that GitReadSession.run() also verifies its own children cannot protect these independent spawnSync calls.
