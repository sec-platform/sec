---
schema: codex-development-work-package-v1
id: ci-linux-reference-sentinels-v1
tracking: none
base: "34fb213d9ccb0e8538302a53feb9015d4e664a57"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: ci-linux-reference-sentinels
    owner: ci-v7-writer
    ownedPaths:
      - docs/work-packages/ci-linux-reference-sentinels-v1.md
      - scripts/run-work-package-gate.ts
      - scripts/work-package-profile-probe.ts
      - tests/contract/semantic-mutation-source-adapter-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
      - tests/unit/work-package-profile-probe-diagnostic.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - platform/
  - scripts/ci-verification.ts
  - scripts/codex/
  - tests/e2e/
acceptance:
  - "Windows profile-probe executable, cwd, and environment paths use Windows path semantics on every host; an invalid relative system root still falls back to C:\\Windows."
  - "Protected directory snapshots bind canonical path, required state, device, inode, and kind without binding the POSIX child-dependent directory link count."
  - "Protected regular-file snapshots retain link-count-one enforcement, content digest binding, reparse rejection, and physical alias rejection."
  - "Replacing a protected directory at the same lexical path changes its snapshot digest, while adding or removing an immediate child directory does not."
  - "The source-adapter filesystem and path owner contract compares deterministic canonical arrays, retaining exact membership and duplicate sensitivity without depending on host readdir order."
  - "The repair changes no workflow, V7 verifier, policy, selector, product, compiler, orchestrator, Bun, Playwright, AppContainer, or Issue 113 surface."
tests:
  - "bun test tests/unit/work-package-profile-probe-diagnostic.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun test tests/contract/semantic-mutation-source-adapter-contract.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "CI=true GITHUB_EVENT_NAME=repository_dispatch SEC_CHANGED_BASE=34fb213d9ccb0e8538302a53feb9015d4e664a57 bun run imports:check"
  - "git diff --check"
---

# CI Linux Reference Sentinels V1

Evidence V3 run `29650437689` 在 Gate03 暴露三个 host-semantics 缺陷：Linux runner 使用 POSIX `path` 处理 Windows `SystemRoot`，生成混合分隔符的 PowerShell、`reg.exe`、cwd 与环境路径；protected-path snapshot 把 POSIX 目录 `nlink` 当作稳定 authority，导致创建或删除直属子目录时出现伪 drift；source-adapter contract 还把 filesystem/path owner 的 exact membership 错误绑定到 host `readdir` 顺序。

本包只修复这三个 reference sentinel。Profile probe 显式使用 `path.win32` 构造和拆分 Windows 路径。Protected-path snapshot 继续绑定目录的 canonical path、required、device、inode 与 kind，但只为 regular file 投影 `nlink`；regular-file `nlink === 1`、内容 digest、reparse 与 alias 检查保持不变。Source-adapter contract 在比较前排序 actual 与 frozen expected owner arrays，保留 exact membership 和 duplicate sensitivity。回归同时证明目录子项变化不改变 authority，以及同路径目录替换仍因 physical identity 变化而被拒绝。本包 rebase 到已包含 #120、#121 与 #122 的 `main`，由 worktree-local tracked hook 对 staged imports 执行 index-only 规范化；不复制或修改 import hook/organizer 或 artifact metadata adapter authority，也不声明任何产品能力变化。
