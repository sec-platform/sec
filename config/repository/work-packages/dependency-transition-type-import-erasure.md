---
schema: codex-development-work-package-v1
id: dependency-transition-type-import-erasure
tracking: issue-313
base: 8a247a30df939a73ba00d99333aac9388627fa43
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: erase-physical-provider-runtime-import
    owner: dependency-transition-contract-owner
    ownedPaths:
      - config/repository/work-packages/dependency-transition-type-import-erasure.md
      - src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts
      - tests/contract/dependency-contract-imports.test.ts
forbiddenPaths:
  - src/adapters/runtime-state/physical/
  - src/adapters/toolchain/dependencies/runtime/dependency-transition/operation.ts
acceptance:
  - dependency transition contract对PhysicalDirectoryIdentity只能使用statement-level import type不得形成physical runtime运行时依赖
  - regression必须从current production source读取真实字节并检查physical runtime import declaration本身为type-only
  - current authoring compiler API在verbatimModuleSyntax下的实际emit不得包含physical runtime import
  - regression必须以inline type specifier负例证明测试能区分会保留空runtime import的旧写法
  - 不改变dependency transition schema validator identity state machine或physical identity语义
  - @typescript/native继续由正式typecheck Gate验证源码本包不把authoring transpile测试冒充TS7最终Gate
tests:
  - tests/contract/dependency-contract-imports.test.ts
---

# Dependency transition 类型导入物理边界

该工作包从旧 `refactor/dependency-materialization@24474fdb…` 中重新提炼唯一仍缺失的正式修复，不重放其长期 diverged 历史。

当前 main 的 transition contract 仍使用 `import { type PhysicalDirectoryIdentity }`。在 `verbatimModuleSyntax` 下，这种 inline type specifier 可能保留空的运行时 import，从而让纯 transition contract 意外加载 physical Provider。改为 statement-level `import type` 后，类型关系不变，但运行时依赖被物理擦除。测试同时固定源码 AST 与 authoring compiler emission；最终源码兼容性和全工程正确性仍由原生 TS7 typecheck/Verification Gate拥有。
