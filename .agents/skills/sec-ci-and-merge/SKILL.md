---
name: sec-ci-and-merge
description: 用于 frozen PR 的 Scope、Quick/Full、selected Risk、merge authorization、squash merge与main readback；不用于普通 Worker开发或改写已有 Evidence 的 head。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-ci-and-merge

## 触发
- frozen same-repository PR已具备 manifest、exact base/head和required local evidence。

## 不触发
- Draft候选未验证；trust-root candidate试图自证；HEAD仍会变化。

## 输入
- PR、expected base/head、manifest path/digest、profile、Review/threads/status。

## 权限与路径
- 只操作正式PR、verification dispatch、merge和已证明安全的branch清理。

## 允许工具与操作
- repository_dispatch、Actions/Status/Review读取、expected-head squash merge、main readback。

## 前置门禁
- PR open非Draft、同仓库、base/head/manifest一致、required evidence与Review满足。

## 执行
1. Scope dispatch必须携带：`client_payload[pull_request]`、`client_payload[expected_head]`、`client_payload[expected_base]`、`client_payload[manifest_digest]`。
2. Verification dispatch必须再携带：`client_payload[schema]=codex-development-frozen-verification-request-v1`、`client_payload[manifest_path]`、`client_payload[profile]`。
3. 同一 exact Gate identity只执行一次；长 Gate独立调用。
4. merge前重读 live PR/base/head、Review、threads、status和manifest。
5. 使用 GitHub squash merge，并以 `sha=$EXPECTED_HEAD` 作为并发前置条件；只有响应 `merged: true` 才完成。
6. merge后读取新 main tree和产品结果，再执行branch/worktree清理。

## 完成证据
- Scope/Verification artifacts、merge response merged:true、main tree/readback、cleanup receipt。

## 停止与恢复
- merge readback与cleanup完成，或准确返回 blocker。
- 任何stale/pending/missing即停止；trust-root改动转manual bootstrap。

## 禁止捷径
- 不 force-push frozen head。
- 不把 skipped、missing、pending、manual-bootstrap-required当PASS。
- 不无条件关闭Issue。

## 权威
- `docs/verification-governance.md`
- `.github/workflows/`
- `scripts/codex/merge-gate.ts`
