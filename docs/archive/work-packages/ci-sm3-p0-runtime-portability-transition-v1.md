---
schema: codex-development-work-package-v1
id: ci-sm3-p0-runtime-portability-transition-v1
tracking: issue-106
base: "b11f2f9f814ea020fe1469f239b006ee95a153fd"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-p0-runtime-portability-transition
    owner: a0
    ownedPaths:
      - docs/work-packages/ci-sm3-p0-runtime-portability-transition-v1.md
      - platform/shared/ci-evidence-composition-policy-registry.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - docs/03-MVP实施计划与路线图.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/evidence/
  - docs/test-feedback-and-ci-lanes.md
  - docs/work-packages/sm3-p0-local-isolated-runner-v1.md
  - platform/compiler/
  - platform/orchestrator/
  - scripts/
  - tests/e2e/
acceptance:
  - "base-owned V7 policy 精确绑定 platform/compiler/verify/run-runtime-verification.ts：base d9c8bf6e3d361146873eb54122c02873f5e8f762 到 candidate 9173cd35533db0317812039eedb0ba68204846ef，以及新增 canonical descriptor platform/compiler/verify/runtime-verification-invocation-contract.ts：candidate 65e4f7eee2e9ac5b1c5afe8d2dfddaaa3be06661。"
  - "base-owned V7 policy 精确绑定 platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts：base 9b84e7da441bd95dcaef171ea1cf4cd4c1e2ee58 到 candidate c5268e1c7288509336db0b838fc9f459fa0b9324。"
  - "base-owned V7 policy 精确绑定 tests/unit/runtime-verification.test.ts：base ad902e8d14f15f6886b147e588c6febdbea4fe6b 到 candidate 8b84a253daa8fce0ae7cf770bc134e1d202fe72a，以及 tests/unit/semantic-mutation-isolated-child-fence.test.ts：base 56c89b78f7a51ceb84eaf59630f4cbae163b8681 到 candidate f3e0ee5034588021676826aa9ebba33810f4981e。"
  - "缺少任一 protected changed record，或任一 base/current blob、mode、type 漂移，全部 fail closed；不匹配的 base identity 不适用本 transition。"
  - "base-side merge-gate fixture 使用同一组五项 anticipated candidate blobs 与完整 changed records 独立重建相同 V7 plan；Gate topology、顺序、argv/env、legacy evidence binding 和唯一 production delta 语义不变，但 selection、inventory 与 policy digest 按完整输入重算。"
  - "本包只更新 base-owned verifier trust root，不修改 PR 113 的产品代码、产品测试、manifest、runtime、production sentinel、依赖或 AppContainer 能力边界。"
  - "PR 113 仍须在本 transition 进入 main 后 rebase、重冻 V2 manifest 并取得一次 exact-head V7 evidence；本包不执行 production sentinel，也不宣告 P0、AppContainer 或 SM-3 完成。"
tests:
  - "bun test tests/unit/ci-evidence-composition-policy-registry.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun test tests/contract/sec-merge-gate.test.ts --test-name-pattern \"base-side V7 merge gate independently reconstructs\" --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=b11f2f9f814ea020fe1469f239b006ee95a153fd bun run imports:check"
  - "git diff --check"
---

# CI SM3 P0 Runtime Portability Transition V1

PR 113 的 hosted Linux production delta 在 capability issuance 阶段遇到标准 `node_modules/.bin/*` 相对符号链接。冻结候选使用纯 TypeScript/Bun，并由一个纯叶 invocation descriptor 同时驱动真实 argv 与 runtime capture：isolated build 执行 `node_modules/next/dist/bin/next build --webpack`，unit 执行 `bun test tests/runtime/unit`，acceptance 执行 `node_modules/@playwright/test/cli.js test --config playwright.config.ts`。两个 direct module 必须是 exact regular nonempty files，并由 source identity/digest、materialize、destination manifest 与 pre-launch proof 全程绑定。所有入口均由 `process.execPath` 加固定 `--no-env-file`、`--config`、`--no-install` 参数驱动，child `PATH` 为空；runtime capture 排除顶层 `.bin`，不生成 shim、不解释 symlink、不提升 `.bin` 执行权限。普通 executable mode 继续绑定，非 `.bin` symlink/reparse 继续 fail closed；Verification report 的 `command` 保持 path-free logical label，不把 host/staging 绝对 argv 写入证据。

本包只提前更新 base-owned V7 transition registry，把 canonical invocation descriptor、两个产品 consumer 与两个对应 unit test 的 exact identity 纳入同一个 fail-closed transition。候选代码在本 trust-root PR 中不复制、不执行，也不由候选 verifier 自授权；本 bootstrap 不运行 CI 或 production sentinel。transition 合入 `main` 后，PR 113 才 rebase、更新 V2 manifest base、重冻并触发唯一一次 hosted production delta。
