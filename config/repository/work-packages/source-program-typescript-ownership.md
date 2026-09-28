---
schema: codex-development-work-package-v1
id: source-program-typescript-ownership
tracking: issue-313
base: 4d7052501167170da4f080b6ae561d7597a888a2
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: reextract-typescript-source-program-ownership
    owner: source-program-model-owner
    ownedPaths:
      - .documentation/source-manifest.json
      - config/repository/work-packages/source-program-typescript-ownership.md
      - docs/开发/原生维护/导入观察与原生资产.md
      - docs/开发/测试发现与执行.md
      - src/adapters/repository/source-program-model/module-graph.ts
      - src/adapters/repository/source-program-model/module-import-provider.test.ts
      - src/adapters/repository/source-program-model/typescript-api-closure.ts
      - src/adapters/repository/source-program-model/typescript-diagnostics.ts
      - src/adapters/repository/source-program-model/typescript-exact-facts.ts
      - src/adapters/repository/source-program-model/typescript-fact-immutability.test.ts
      - src/adapters/repository/source-program-model/typescript-fact-shards.ts
      - src/adapters/repository/source-program-model/typescript-incomplete-input.test.ts
      - src/adapters/repository/source-program-model/typescript-incremental.ts
      - src/adapters/repository/source-program-model/typescript-input.ts
      - src/adapters/repository/source-program-model/typescript-lowering.ts
      - src/adapters/repository/source-program-model/typescript-model-assembly.ts
      - src/adapters/repository/source-program-model/typescript-module-graph.ts
      - src/adapters/repository/source-program-model/typescript-module-import-cases.json
      - src/adapters/repository/source-program-model/typescript-module-imports.test.ts
      - src/adapters/repository/source-program-model/typescript-module-imports.ts
      - src/adapters/repository/source-program-model/typescript-module-load-consistency.test.ts
      - src/adapters/repository/source-program-model/typescript-module-loader.ts
      - src/adapters/repository/source-program-model/typescript-performance.ts
      - src/adapters/repository/source-program-model/typescript-profile.ts
      - src/adapters/repository/source-program-model/typescript-provider-boundary.test.ts
      - src/adapters/repository/source-program-model/typescript-query.ts
      - src/adapters/repository/source-program-model/typescript-return-provenance.ts
      - src/adapters/repository/source-program-model/typescript-syntax.ts
      - src/adapters/repository/source-program-model/typescript-workspace.ts
      - src/adapters/repository/source-program-model/typescript.ts
      - src/adapters/repository/source-program-model/workspace-source-authority.ts
      - src/adapters/repository/source-program-model/workspace-source-content.ts
      - src/adapters/repository/source-program-model/workspace-source-snapshot.ts
      - src/adapters/repository/source-program-model/workspace-typescript-config.test.ts
      - src/adapters/repository/source-program-model/workspace-typescript-config.ts
      - src/adapters/repository/source-program-model/workspace-typescript-project-roots.test.ts
      - src/adapters/repository/source-program-model/workspace-typescript-project.ts
      - src/adapters/toolchain/typescript/snapshot-directory.test.ts
      - src/adapters/toolchain/typescript/snapshot-directory.ts
      - src/contracts/utf8.test.ts
      - src/contracts/utf8.ts
      - tests/unit/module-graph-runtime-union.test.ts
forbiddenPaths:
  - .github/
  - src/adapters/providers/git-read/
  - src/adapters/repository/architecture/
acceptance:
  - #632的40-path formal source delta必须相对current main重新提炼不得重放其旧base历史
  - 32个新增职责文件必须拥有TypeScript exact fact input lowering module graph workspace authority config project query performance等内部状态与机制
  - typescript.ts与workspace-source-snapshot.ts只能作为current public API facade且type/value export集合必须与current main精确相同
  - current SecRepository module naming sec.module.json descriptor semantics exact-Git API命名与sync plus retained-session exact-tree入口不得回退
  - resolver candidate顺序是语义precedence不得presentation sort且所有candidate subset由first admitted target决定
  - TypeScript module loader的unknown/import-type/inline-type runtime语义必须有current frontend regression
  - TypeScript fact shards必须深层不可变 foreign input重走canonical parse producer快照不得由外部引用静默修改
  - workspace TypeScript config仍以virtualRoot为解析基准合法empty project由TypeScript自身复验
  - workspace dependency/default-host access必须保持current main containment语义不得恢复旧externalHost broad admission
  - canonical docs source identity必须同步
  - 不新增旧短名public compatibility API内部短名只存在于owner-local实现
tests:
  - src/adapters/repository/source-program-model/module-import-provider.test.ts
  - src/adapters/repository/source-program-model/typescript-fact-immutability.test.ts
  - src/adapters/repository/source-program-model/typescript-incomplete-input.test.ts
  - src/adapters/repository/source-program-model/typescript-module-imports.test.ts
  - src/adapters/repository/source-program-model/typescript-module-load-consistency.test.ts
  - src/adapters/repository/source-program-model/typescript-provider-boundary.test.ts
  - src/adapters/repository/source-program-model/workspace-typescript-config.test.ts
  - src/adapters/repository/source-program-model/workspace-typescript-project-roots.test.ts
  - src/adapters/toolchain/typescript/snapshot-directory.test.ts
  - src/contracts/utf8.test.ts
  - tests/unit/module-graph-runtime-union.test.ts
---

# TypeScript Source Program ownership re-extraction

该工作包把 closed draft #632 的 formal 40-path Source Program/TypeScript delta重新建立在 current main 上，而不是把长期 diverged `fix/module-resolution-order` 当成等待合并的功能包。

核心变化是把旧巨型 `typescript.ts` 与 `workspace-source-snapshot.ts` 的实现责任拆回内部 owner，同时保持 current main 已经收敛的 `SourceProgram*` / `Workspace*` 公共 API 完全不变。所有 #632 之后进入 main 的命名、`sec.module.json`、exact-Git、dependency/default-library containment 和双 exact-tree acquisition 语义必须先融合后才能形成候选。旧分支只作为 re-extraction source evidence。
