---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-core-import-diagnosis-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: diagnose-core-import-boundary-without-execution
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-core-import-diagnosis-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-core-import-diagnosis.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - scripts/
  - tests/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-termination-trace-repair.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-bootstrap-tamper-fixture.json
  - docs/work-packages/sm3-add-state-transition-vertical-v4.md
  - docs/work-packages/sm3-isolated-verification-termination-trace-repair-v1.md
  - docs/work-packages/sm3-isolated-verification-bootstrap-tamper-fixture-v1.md
acceptance:
  - "The terminal vertical-v4 evidence remains exact and is not retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json sha256:ac04b179c88b4aea3588e3293c972265ab65f49cfc88052aff4d99edb181aa0f."
  - "The exact child host, runtime plan, progress/bootstrap and heavyweight core sources are sha256:8e0ea1e50799c038a8d3ab89060b92cbb9fe373721d8911c02933bc40209f969, sha256:ab6081c8db6c7919eef72952634298b1cfbb664946dd05c460d863b58ec67c91, sha256:f16a2bd42030775a9879cfc0645f04f51eeddc66fb845de27c3bd01f8be7ba18 and sha256:9c00a0aaa25fae1b17fbb98cf3a7761e7785d50744e18c027631fdb1a5784fdb."
  - "The exact repository, ts-morph, TypeScript, @ts-morph/common and code-block-writer package manifests are sha256:4f1460bcae3ec1a521ab494aff3c7dd95b247082e148dd90c97976a25b4b3cb0, sha256:8318b74ce9398ad5bedf8d08a01c6fce5c15be62074f0771a628a526096acf3f, sha256:9332e97c30d3e53ed54910b89207ed657fb444066484df6e5b6965bf130865e9, sha256:503a31364718379c92bb5b15b44d38c8e9c8dc1cff9710f44706127d7a16f931 and sha256:9cda7d438f24804ee55fea9e8ebec2d27bc7fbe86a5a412f0f1843a2fa1d29dd."
  - "Two independent read-only static reviews agree that production external seeds and the recursively materialized physical package closure have no source-proven mismatch; rootCause remains null."
  - "At most one in-memory Bun.build runs with the exact production entrypoint and options: format esm, minify false, sourcemap none, splitting false, target bun, external ts-morph and typescript."
  - "The build has no outdir and no write option. Its sole output is never written, imported or executed; one bounded Bun.Transpiler.scan may inspect the in-memory JavaScript text."
  - "The command emits only a canonical JSON array of unique external import specifier/kind pairs. It emits no bundle bytes, source excerpt, host path, caught error, stdout/stderr payload or dynamic runtime value."
  - "Live-source and package-manifest inspection may compare the emitted specifiers with the recursive dependency closure, package entry/export mode and the staged importer/node_modules topology."
  - "The diagnosis does not import the core, execute the runner main, materialize a runtime, launch AppContainer, query a profile/registry, run a test, rerun vertical-v4, alter a timeout or trigger GitHub Actions."
  - "If the bounded scan does not uniquely prove a root cause, evidence must record rootCause=null and authorize only a separately frozen manifest-bound staged loader with finite path-free dependency checkpoints."
tests:
  - "One in-memory production-equivalent Bun.build followed by one bounded Bun.Transpiler.scan; emit only canonical external import specifier/kind JSON."
  - "git diff --check -- docs/work-packages/sm3-isolated-verification-core-import-diagnosis-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-core-import-diagnosis.json"
---

# SM3 Isolated Verification Core Import Diagnosis V1

Vertical-v4 已经把失败压缩到 `bootstrap-entered` 之后、`module-entered` 之前。两个独立静态审计均确认：production bundle 只显式 externalize `ts-morph` 与 `typescript`，runtime plan 以同一两项递归物化 dependency closure，现有源码没有证明二者不一致。

本包只验证 emitted bundle 的 external import surface，不执行任何 emitted code。若一次内存 build/scan 仍不能唯一定位，必须保持 `rootCause = null`，下一步另冻一个位于 bootstrap 与 heavyweight core 之间的有限 staged loader；不得把推测写成修复。
