---
schema: codex-development-work-package-v1
id: native-copy-directory-adoption-20261002
tracking: none
base: ff7a8707fdde08953a578bba89ec4637ce3a53ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: compare-materialized-directory-contents
    owner: physical-directory-tree-copy
    ownedPaths:
      - "src/adapters/runtime-state/physical/runtime/physical-directory-tree-copy.ts"
      - "tests/unit/physical-no-follow-resource-boundary.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/task-group-cancellation-adoption-20261002.md"
      - "config/repository/work-packages/native-copy-directory-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve exact independently reviewed physical-copy and direct-regression postimages published at a4059039b1e7c816da6ff388d59bfec3f586234a and 99f6f35e34245d73e907942479b7ba9d57d4d3b5"
  - "Omit only filesystem-specific directory storage size when comparing a newly materialized target; retain complete ordered membership, kinds, file/link sizes, content digests and requested modes"
  - "Keep directory size in same-source reobservation; retain source/parent identity, special-mode ownership, retained handles, resource bounds and failure/cleanup owners"
  - "Retain the original preload-owned cross-filesystem Cache fixture and all negative observation controls; do not relabel non-Linux or same-device skips as real cross-filesystem evidence"
  - "Adopt only the causal physical copy owner and its direct test; ordinary Upgrade, Product and Repair changes remain separate obligations"
  - "Reuse exact source-bound native evidence and input checks without claiming current-main Upgrade recovery, Windows, full Gate, physical provider or Q4 qualification"
  - "Use unchanged trusted-main proposal compiler, truthful PRE and exact independent integration review before protected expected-head merge and precise main readback"
tests:
  - "tests/unit/physical-no-follow-resource-boundary.test.ts"
---

# Compare copied directory contents across filesystems

The existing physical-copy comparator distinguished neither a newly materialized target nor same-source drift. Directory storage length is not portable content identity. This source repair separates those two uses inside the original owner while preserving every content, metadata, identity and resource fence. Existing public contracts already require this behavior, so no docs or documentation projection is included.
