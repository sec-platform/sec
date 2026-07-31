---
schema: codex-development-work-package-v1
id: affected-selection-trust-boundary-v1
tracking: issue-206
base: 597b42fedeb4ee0994b4c56c48f378562766d28b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: affected-selection-trust-boundary
    owner: affected-selection-worker
    ownedPaths:
      - platform/shared/test-impact-contract.ts
      - platform/shared/affected-test-inventory.ts
      - platform/dev-runner/test-runner.ts
      - platform/dev-runner/check-runner.ts
      - tests/unit/test-runner.test.ts
      - tests/unit/test-impact-cache.test.ts
      - tests/unit/local-gate-union.test.ts
      - tests/contract/affected-selection-trust-boundary.test.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/affected-selection-trust-boundary-v1.md
      - docs/work-packages/canonical-text-bytes-phase-a-v1.md
      - docs/archive/work-packages/canonical-text-bytes-phase-a-v1.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - .gitattributes
  - .editorconfig
  - .prettierrc.json
  - AGENTS.md
  - README.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/registry/
  - platform/policies/
  - platform/upgrade/
  - platform/cli/
  - platform/shared/verification-result-contract.ts
  - platform/shared/verification-types.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/ci-artifact-contract.ts
  - platform/shared/ci-artifact-types.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-execution-environment.ts
  - platform/shared/ci-git-changed-files.ts
  - platform/shared/ci-pr-risk-selection.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/error-protocol.ts
  - platform/shared/error-protocol-contract.ts
  - platform/shared/verification-scope-inventory.ts
  - scripts/codex/
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - .github/workflows/
  - docs/authority.json
  - docs/work/current-state.yaml
  - docs/goals/
  - source/
  - project/
  - control/
  - tests/e2e/
  - tests/integration/
  - tests/contract/repository-audit.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/verification-result-contract.test.ts
  - tests/contract/test-impact.test.ts
acceptance:
  - "platform/shared/test-impact-contract.ts 持久 cache 使用 envelope（schema/parserRuntimeIdentity/parserOptionsDigest/contractRevision），entries 以 (testFile, sourceDigest) 为身份；不再以 mtimeMs 作为充分身份；mtime 仅作为可选 fast-path 提示，digest 仍是唯一身份。"
  - "loadPersistentTestImpactCache 在 envelope schema/parser/contract revision 不匹配时整体丢弃缓存（不混用旧条目）；corrupt 或 unknown-schema 缓存被拒绝并有可观察信号（stderr warning）；不静默 empty。"
  - "readTestImportSpecifiers 在 stat/read 失败时返回 'unresolved' 信号而非空 specifier 数组；buildReverseImportMap 收集 unresolvedTestFiles 并由 selectTestsForSources/CodexDevelopmentBuildAffectedTestInventoryV1 透传，sourceChanged && unresolvedTestFiles.length > 0 时 selectionResolved=false。"
  - "same mtime + different bytes 必然重新解析：readTestImportSpecifiers 通过 sourceDigest 比对检测内容变化，不依赖 mtime。"
  - "parser/runtime/contract revision 变化使全部 entries 失效；常驻进程可通过 invalidateReverseImportMap() 局部或整体失效；cache on/off 选择 byte-equivalent。"
  - "并发 writer 通过原子 rename + 自验证 entries 保证最终 cache 属于一个完整输入 epoch；任何条目在 read 时由 digest 自证。"
  - "platform/shared/affected-test-inventory.ts 定义 AffectedSelectionTrustBoundary（applicable-no-tests | applicable-with-tests | unresolved-selection | unresolved-test-source | broad-fallback | unresolved-ownership | unresolved-git）并投影到 VerificationGateResultV1（不修改 verification-result-contract.ts；使用 type-only import + 本地 schema 常量避免拉入 TCB runtime closure）。"
  - "platform/dev-runner/test-runner.ts 在 sourceChanged=true 且 selectedFastTests=[] 且 fallback 关闭时返回非零 exit code 并投影 invalidated/selection-unresolved；--plan 输出包含 verificationResult 字段；非 source-only change 且确无适用测试时按明确 applicability 处理。"
  - "platform/dev-runner/check-runner.ts 在 selection unresolved 时不静默跳过 test:affected gate；buildLocalAffectedCheckPlan 的 gates 选择反映信任边界。"
  - "tests/unit/test-impact-cache.test.ts 覆盖：digest 身份、same mtime + different bytes 重新解析、envelope revision 不匹配整体丢弃、corrupt 缓存拒绝重建、cache on/off 等价。"
  - "tests/unit/test-runner.test.ts 覆盖：sourceChanged + empty + fallback off → 非零 + selection-unresolved；--plan 投影 verificationResult；保留现有 fallback on / slow notice 行为。"
  - "tests/contract/affected-selection-trust-boundary.test.ts 覆盖 #206 必须回归 10 条中的端到端场景：source 变化 + empty closure → invalidated/non-zero；same mtime + different bytes → 重新解析；source read/stat failure → unresolved；corrupt/unknown-schema cache → 拒绝重建；test delete/rename → 旧 edge 不残留；parser/contract revision 变化 → 全部失效；cache on/off byte-equivalent；每个信任边界到 VerificationGateResultV1 的投影经 CodexDevelopmentAssertVerificationGateResultV1 验证。"
  - "不修改 verification-result-contract.ts、verification-types.ts、CI workflow、package/lock、docs authority；docs:doctor 0 error；typecheck passes；test:fast passes。"
tests:
  - tests/unit/test-impact-cache.test.ts
  - tests/unit/test-runner.test.ts
  - tests/unit/local-gate-union.test.ts
  - tests/contract/affected-selection-trust-boundary.test.ts
---

# affected-selection-trust-boundary-v1

Issue #206. 消灭 affected-selection 空选择假绿与陈旧 Test Impact 缓存。

## 范围

- Affected selection 结果边界：sourceChanged=true 且选择闭包未被证明完整时 fail-closed（invalidated/selection-unresolved）。
- V1 direct-import cache 身份/失效：sourceDigest + parser/contract/schema revision envelope。
- 读/stat 失败 → unresolved 信号（不减少闭包）。
- 投影到 PR #204 进入 main 的统一 VerificationGateResultV1（复用，不修改 core）。

## 不在范围

- #188 Semantic Test Impact Graph V2。
- #179 通用 CAS。
- #189 Daemon。
- 迁移全部产品 Verification 写入者。
- 修改 CI workflow、package/lock、docs authority、verification-result-contract.ts core。

## 根因

test-runner.ts:465-484 在 sourceChanged=true 且 selectedFastTests=[] 时直接 return 0，把"选择器没找到测试"伪装成"无影响"。test-impact-contract.ts 持久 cache 仅以 (testFile, mtimeMs) 为身份，无 parser/contract/schema revision，corrupt 静默 empty，read/stat 失败返回空 specifier 数组（减少闭包）。

## 实现要点

1. Cache envelope: `{ schema, parserRuntimeIdentity, parserOptionsDigest, contractRevision, entries: { testFile: { sourceDigest, specifiers, mtimeMs, size } } }`。mtime/size 仅作 fast-path 提示；digest 是唯一身份。
2. readTestImportSpecifiers 返回 `string[] | 'unresolved'`；buildReverseImportMap 收集 unresolvedTestFiles。
3. 新增 invalidateReverseImportMap() 供未来 Daemon 调用。
4. affected-selection-result.ts: AffectedSelectionTrustBoundary 分类 + projectToVerificationGateResult()。
5. test-runner.ts: 接入信任边界，空选择 fail-closed，--plan 投影 verificationResult。
6. check-runner.ts: 信任边界驱动 gate 选择。
