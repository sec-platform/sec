---
title: Slow Suite Registry
status: active
last-reviewed: 2026-07-12
---

# Slow Suite Registry

本文定义 slow test 的运行、选择和 CI 分片规则。具体 Suite ID、owner、timeout 和 file membership 以 `platform/shared/test-budget-contract.ts` 为唯一事实源。

## 1. 定位

`tests/e2e/**/*.test.ts` 与 `*.spec.ts` 默认属于 slow coverage。Slow Test 用于 Release/Full correctness 和 PR Risk 的定向高成本验证，不属于 PR Quick 默认路径。

Suite 默认 file-granular。只有需要共享 setup、顺序或诊断时才把多个文件归组。

## 2. 命令

```bash
bun run test:slow
bun run test:slow -- --suite <suite-id>
bun run sec -- test budget --json --compact
```

未知 Suite ID 必须 fail fast 并输出可用 ID，不能静默回退到全量 slow。

## 3. Lane 责任

```text
PR quick
  → 只报告 affected slow notices

PR risk
  → 运行 impact-selected slow suites/files
  → broad infrastructure risk 可运行 Registry 声明的 bounded baseline

release/full
  → 按 Suite ID 矩阵运行完整 slow coverage
```

## 4. 并行

Registry 声明 Suite 是否允许在 PR Risk Job 内并行。资源敏感、端口共享或需要顺序的 Suite 保持串行。

Release/Full 按 Suite ID 分片，以 wall-clock speed 和诊断性为目标。

Ticket semantic vertical 必须拥有显式 suite/owner，不得落入 `other` fallback；它在 Full 中强制验证 canonical frontend、validated IR、linker、IR-owned generator、runtime enforcement、projection 与 provenance 的同一母例。

## 5. 文档与测试规则

- 不在 Markdown、Workflow、Test 中复制 Suite ID 列表。
- 使用 `slowTestSuiteIds()` / `getSlowTestSuitesSync()` 或 materialized test budget contract。
- 不根据文件名猜 owner/timeout/parallel safety。
- 修改 Registry 后必须验证 count/list consistency 和 sorted unique invariants。

## 6. 失败策略

Slow failure = 实现回归或预期合同变化。先分类，再修实现或更新 assertion。

禁止删除 Slow Test 来隐藏回归；禁止把全部 Slow Test 移进 affected/fast。
