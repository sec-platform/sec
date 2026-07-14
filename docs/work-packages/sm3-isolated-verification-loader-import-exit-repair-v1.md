---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-loader-import-exit-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: distinguish-caught-loader-import-rejection-from-abnormal-termination
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-loader-import-exit-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-loader-import-exit-repair.json
      - platform/compiler/semantic-mutation/isolated-verification-child-progress.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - scripts/
  - platform/shared/
  - platform/orchestrator/
  - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
  - platform/compiler/verify/semantic-mutation-verification-adapter.ts
  - platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts
  - tests/integration/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v5-verification.json
  - docs/work-packages/sm3-add-state-transition-vertical-v5.md
acceptance:
  - "The terminal vertical-v5 evidence remains exact and is not retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v5-verification.json sha256:2b87b4423dc2380fa3a860d6caaab40272f82bc00d05dd3b988553a9d6456ab2 with loader-entered/unclassified-nonzero and rootCause=null."
  - "The predecessor progress and host sources are exact: sha256:cc6b6ab681e61310d4a777a9f230014fa793505cb52f5a601c221cea12bf6e90 and sha256:8c147484261e37ce6e19475f473c7245f8c66680f2d296a9d0aff1fa66e6bcae."
  - "The predecessor unit and contract tests are exact: sha256:9e201a07e366ad9573559c928cdd928eaf2a149d462851fb4778bd20293fc41a and sha256:2c22879dc8e88334c1860b77820721623c864d23a4d0ab38ab98eb8232683d26."
  - "One new reserved child exit code 75 maps only to loader-import-failure. Existing codes 70 through 74 and unclassified-nonzero retain their meanings."
  - "The literal staged loader maps only a caught dependency/core dynamic-import rejection to 75. Progress publication failure remains 74; an engine crash or other abnormal process termination remains unclassified-nonzero."
  - "Host coherence accepts loader-import-failure only with no child outcome or pending outcome, no pending checkpoint, and last checkpoint loader-entered, typescript-imported, ts-morph-imported or core-import-started."
  - "loader-import-failure can only refine child-terminated-without-outcome. It cannot permit reports before verify-all, create PASS, enter success rawDigests or alter canonical Verification artifacts."
  - "No caught Error, message, path, stdout/stderr, raw exit value or extensible payload crosses the boundary."
  - "No dependency closure, runtime plan algorithm, external package list, runner, pipeline, timeout, AppContainer, profile or registry behavior changes. Generated loader bytes remain automatically bound by the existing runtime plan digest and destination manifest."
  - "Two independent read-only static reviews must report no blocker before one focused unit-plus-contract batch runs. No production AppContainer, real vertical, old Gate, full/slow matrix or Actions run is allowed in this package."
  - "A focused PASS authorizes only a separately frozen real add-state-transition vertical-v6. It does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- platform/compiler/semantic-mutation/isolated-verification-child-progress.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts docs/work-packages/sm3-isolated-verification-loader-import-exit-repair-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-loader-import-exit-repair.json"
---

# SM3 Isolated Verification Loader Import Exit Repair V1

Vertical-v5 已把失败推进到 `loader-entered → typescript-imported`，但普通 import rejection 与 abnormal termination 仍共用 `unclassified-nonzero`，所以不能据此修改 dependency closure 或 package layout。

本包只恢复这一位信息：staged loader 捕获到的 dependency/core import rejection 使用固定 exit `75`；异常终止仍保持 unclassified。Last checkpoint 继续决定具体 import 区间，错误对象与输出不跨越边界。
