---
schema: codex-development-work-package-v1
id: code-scanning-projection-determinism
tracking: issue-313
base: a15ef4b1c7d19fcc2521fa9b126cad87d8ace14d
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: reextract-code-scanning-projection-invariants
    owner: code-scanning-projection-owner
    ownedPaths:
      - config/repository/work-packages/code-scanning-projection-determinism.md
      - src/adapters/verification/platform/ci/runtime/code-scanning-projection.ts
      - tests/unit/code-scanning-projection.test.ts
forbiddenPaths:
  - .github/workflows/
  - src/adapters/providers/github-api/
acceptance:
  - current runtime projection使用locale-independent UTF-16 code-unit comparator不得依赖localeCompare或ambient ICU locale
  - findings输入顺序置换不得改变投影字节
  - severity仍先于path startLine ruleId alertNumber排序且同severity路径使用canonical code-unit order
  - 投影必须继续明确声明GitHub Code Scanning是权威安全证据SEC comment只是projection
  - 旧stale-source的单页100条上限不得恢复current runtime继续使用bounded multi-page inventory并在page budget耗尽时fail closed
  - 旧PR endpoint与comment PATCH测试不重复搬运因为current GitHubApi owner已有更精确ref-scoped endpoint和exact PATCH覆盖
tests:
  - tests/unit/code-scanning-projection.test.ts
---

# CodeQL PR projection 确定性回归

该工作包从 `feat/code-scanning-pr-projection@3eed8ff7…` 重新提炼仍有独立价值的测试义务，并按 current main 的真实实现修正已过时假设。

旧分支的 `>100 findings` 失败语义已经被当前最多 32 页、每页 100 条的有界分页取代，不再回灌；GitHub API endpoint 与 exact comment PATCH 也已有更强现行测试。仍应保留的是输入顺序不影响投影、projection 明确非权威。审计同时发现当前 renderer 使用 `localeCompare`，会把排序依赖宿主 locale/ICU，因此改为仓库 canonical code-unit comparator。
