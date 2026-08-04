---
name: sec-ci-and-merge
description: 对 frozen PR 执行 exact Scope/Verification、合并授权、squash merge 与 new-main readback；不用于开发中候选。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-ci-and-merge

## 触发
- Role=Integrator，operation=`integrate`，candidate=frozen，Evidence 与独立 Review 已具备。

## 不触发
- Draft/变化中的 head；trust-root candidate 试图自证；任一 required Evidence 缺失。

## 输入
- PR、exact base/head/tree、manifest digest、profile、Review、threads、checks。

## 权限与路径
- 仅操作 verification dispatch、PR merge 和已证明安全的 closeout。

## 允许工具与操作
- GitHub status/Review、repository_dispatch、expected-head squash merge、main readback。

## 前置门禁
- 完整 Envelope、merge capability、trusted verifier；适用性状态必须为 `applicable`。

## 执行
- Scope 请求携带 `client_payload[pull_request]`、expected head/base 与 manifest digest。
- Verification 请求再绑定 schema、manifest path 和 profile。
- merge 前重读 live PR、Review、threads、checks 和 exact identities。
- 只有 squash 响应 `merged: true` 才进入 new-main readback 与清理。

## 完成证据
- Scope/Verification artifacts、Review state、merge response、main tree/readback、cleanup receipt。

## 停止与恢复
- 任何 stale/pending/missing/manual-bootstrap-required 即停止；成功后完成 readback。

## 禁止捷径
- 不把 skipped/pending 当 PASS，不 force frozen head，不无条件关闭 Issue。

## 权威
- `docs/verification-governance.md`
- `.github/workflows/`
- `scripts/codex/merge-gate.ts`
