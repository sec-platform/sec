---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-23
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:2e0fcb016363545d98be86961b14eac8168d5ddfb1c3f6ade55c352716d544de",
    "manifestPath": "docs/work-packages/generated-ignored-state-lifecycle-v1.md",
    "packageId": "generated-ignored-state-lifecycle-v1",
    "tracking": "issue-271"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "8ce841fc8178d2f5ec140d8daf122b9cc65bf80b",
    "sourceManifestDigest": "sha256:2e0fcb016363545d98be86961b14eac8168d5ddfb1c3f6ade55c352716d544de",
    "sourcePointerRevision": "sha256:d818fb813410b88e928fc88dca6979ccc60ff31de5fc5dc6079ef43437511e3c",
    "sourceRollingRevision": "sha256:35801b27bf4f1b6fb70b83fee2b3fbb202a9bd1dbf6d1cba6f72594843fdf143",
    "sourceTree": "c36dba6b292c90fc35d435b4bd3e92e86beb2dae"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "git-worktree-physical-closeout-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "cf59ef7b1e166fa184592ab870fa5788466e2df9",
  "exactMainTree": "92fb08917f7bffac00e63ce64e2fd761ddeab7e8",
  "projectionDigest": "sha256:2c207317fe556992b66e770a41024af715d3ad7f5c445fe039c615322038b8c3",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### generated-ignored-state-lifecycle-v1

Existing active package replan bound to exact source head `8ce841fc8178d2f5ec140d8daf122b9cc65bf80b`, source tree `c36dba6b292c90fc35d435b4bd3e92e86beb2dae`, manifest `sha256:2e0fcb016363545d98be86961b14eac8168d5ddfb1c3f6ade55c352716d544de`, and authority `sha256:fef0e7bd23080fc8806f7dec0cb37ed028890d38936bc706e3834d77b227d1ec`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:fef0e7bd23080fc8806f7dec0cb37ed028890d38936bc706e3834d77b227d1ec`.

### 2. git-worktree-physical-closeout-v1

Retained ordered candidate from transition authority `sha256:fef0e7bd23080fc8806f7dec0cb37ed028890d38936bc706e3834d77b227d1ec`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:fef0e7bd23080fc8806f7dec0cb37ed028890d38936bc706e3834d77b227d1ec`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:fef0e7bd23080fc8806f7dec0cb37ed028890d38936bc706e3834d77b227d1ec`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
