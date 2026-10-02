---
schema: codex-development-work-package-v1
id: source-run-alias-adoption-20261002
tracking: none
base: eff2803f671c7ae2a4b3a17f973f8a01f71ad820
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: repair-source-run-alias-observation
    owner: repository-source-program
    ownedPaths:
      - "src/adapters/repository/source-program-model/embedded-programs.ts"
      - "src/adapters/repository/source-program-model/embedded-programs.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/trusted-source-publication-adoption-20261002.md"
      - "config/repository/work-packages/source-run-alias-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve the two independently reviewed and published parser/test postimages from checkpoint 36766add90e5fb2987a7235c09f8b75507fb8bc1"
  - "Resolve each workflow run alias through the original parsed YAML document and retain its distinct occurrence address, provider context and anchored source span"
  - "Reject missing or nonstring alias targets and conflicting uses/run commands; preserve explicit unknown shell import closure and do not execute parsed commands"
  - "Limit bounded admission-mechanism repair to the proven missed executable occurrence; no unrelated CLI product change or workflow transport is included"
  - "Use original trusted-main proposal compiler and exact external review; retain truthful PRE classification and required protected security checks with expected-head merge/readback"
tests:
  - "src/adapters/repository/source-program-model/embedded-programs.test.ts"
---

# Repair workflow run alias source observation

The baseline Source Program parser omits aliased run occurrences and silently ignores unresolved aliases. The already reviewed two-path repair makes these exact source observations complete or explicitly rejected. This proposal does not activate Work, issue Q4/Gate authority, or qualify unrelated product changes.
