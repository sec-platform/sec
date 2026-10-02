---
schema: codex-development-work-package-v1
id: maintenance-association-diagnostic-adoption-20261002
tracking: none
base: 35545c0a35ee5b42ff88e18f40898ba2165ae920
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: observe-maintenance-association-rejection
    owner: repository-maintenance
    ownedPaths:
      - ".github/workflows/repository-maintenance.yml"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/source-program-incremental-adoption-20261002.md"
      - "config/repository/work-packages/maintenance-association-diagnostic-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve the independently reviewed published workflow postimage from 3dc012efe3f1df88dc435190308aa9e470066f2b"
  - "Add only associationFieldPresent and allowlisted associationShape after the unchanged carrier predicate rejects"
  - "Preserve every existing acceptance guard, normalized maintain/admin permission requirement, owner/member association requirement, workflow identity, main binding, request parser and throw"
  - "Do not log raw comment content, digest, actor, credentials or arbitrary API values; emit no new diagnostic on acceptance"
  - "Source adoption does not authorize request admission, dispatch or branch deletion; existing 82 local decision-parity cases do not prove actual hosted fields"
  - "Use original trusted-main proposal compiler, truthful PRE and exact independent review before protected expected-head adoption/readback"
tests:
  - "tests/contract/repository-maintenance-workflow.test.ts"
---

# Observe rejected carrier association shape

The original-path hosted diagnostic isolated associationAccepted=false. The existing contract remains unchanged. These two bounded fields distinguish absent or unknown association data from fixed GitHub enum values at the original rejection point, before any maintenance effect. The known unrelated obsolete permission-text contract test is preserved pending its separate formal adoption.
