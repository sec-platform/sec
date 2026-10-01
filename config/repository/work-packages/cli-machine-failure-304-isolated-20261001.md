---
schema: codex-development-work-package-v1
id: cli-machine-failure-304-isolated-20261001
tracking: none
base: 48c24108ac7c1669685790bdb1e5e13bab24783c
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: project-native-cli-parse-rejections
    owner: cli-operation-adapter
    ownedPaths:
      - src/entry/cli/cli.ts
      - tests/contract/cli-usage-process.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/engineering-decision-records-20261001.md
      - config/repository/work-packages/cli-machine-failure-304-isolated-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
  - docs/
  - .documentation/
  - crates/
  - src/contracts/canonical.ts
  - src/adapters/filesystem/write-lease.ts
  - src/adapters/repository/source-program-model/
acceptance:
  - This external-maintainer source proposal issues no active Work, Gate, health, adoption or automatic integration authority
  - Native Commander parse rejection uses existing CLI-USAGE-001 semantics, safe constant machine data on stdout, empty stderr and exitCode 2 without immediate process exit
  - Only selected command ancestry and CLI-sourced output flags select JSON; Commander retains ownership of delimiters and option values
  - Unsupported JSON success modes reject before effects while known command output, help and version behavior remain intact
  - Preserve ordinary repair persisted-plan readback and legacy domain or decoder failures until their separately retained result-return migration
  - Reuse exact reviewed two-file bytes and unchanged dependency generation for prior ten production-entry observations and selected-file diagnostics
  - Keep the admitted independent root and ref disjoint from the old unknown lease generation; copy no old control state, index, journal, grant or runtime identity
  - Preserve the original physical lease and interrupted-operation obligations as unknown under issue 190 without claiming termination or cleanup
  - Obtain fresh canonical proposal control admission and exact-head review before authorized independent branch publication; root owns main merge and readback
  - Keep issue 304 open for remaining domain projection, full stream and exit matrix, decoder, packed runtime and cross-platform obligations
  - Do not run full source assessment, unrelated broad tests, new dependency installation or Rust changes
tests:
  - tests/contract/cli-usage-process.test.ts
---

# Native CLI parse rejection in an independently admitted root

The fixed source patch is reconstructed from its exact base after a confirmed
cross-invocation PID-namespace identity failure left the original physical lease
unknown. This proposal inherits no old operation authority or terminal claim.
CLI machine transport remains limited to admitted native parser rejection.
