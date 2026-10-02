---
schema: codex-development-work-package-v1
id: maintenance-diagnostic-adoption-20261002
tracking: none
base: a005513b5a1f60fac0d6163e49144c4a17148f89
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: observe-maintenance-carrier-rejection
    owner: repository-maintenance
    ownedPaths:
      - ".github/workflows/repository-maintenance.yml"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/import-config-cache-adoption-20261002.md"
      - "config/repository/work-packages/maintenance-diagnostic-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve the independently reviewed published workflow postimage from faff9be55f1ff3e862a694d2765d9474456543b3"
  - "Log only fixed schema, comparison and presence Booleans, and allowlisted permission/role labels after the existing carrier predicate rejects"
  - "Preserve the complete original acceptance predicate, permission normalizer, main binding, parser, throw, triggers, action pins and declared permissions"
  - "Do not log raw comment, digest, actor, token, payload identifiers or arbitrary response data; no output on the accepted branch"
  - "No dispatcher run, branch cleanup or authorization conclusion is issued by this diagnostic source proposal"
  - "Use original trusted-main proposal compiler, truthful PRE and exact independent review before protected expected-head adoption/readback"
tests:
  - "tests/contract/repository-maintenance-workflow.test.ts"
---

# Observe rejected maintenance carrier comparisons

The original maintenance carrier rejects with one combined error. This source-only diagnostic exposes bounded comparison outcomes after rejection without relaxing any gate or changing Effects. Eleven existing local parity cases are distinct from actual hosted fields and do not prove the rejected request was authorized.
