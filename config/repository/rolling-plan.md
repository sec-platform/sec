---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-02
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:aad8c25ebd09419e6cd7872bc01ffd533c87a736ba0ca947640c623f51673ef3",
    "manifestPath": "config/repository/work-packages/audit-worker-argv-adoption-20261002.md",
    "packageId": "audit-worker-argv-adoption-20261002",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "113772b66115c35c8899a8ce1e09a7986fdeade5",
  "exactMainTree": "ca823ffef2325a2f26d4cef9ef582ef8ffe698ca",
  "projectionDigest": "sha256:b21174c1f571c90a68a596c956f5bb0283bab1751a821e56b00f7fb194c5841d",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### audit-worker-argv-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/audit-worker-argv-adoption-20261002.md` at `sha256:aad8c25ebd09419e6cd7872bc01ffd533c87a736ba0ca947640c623f51673ef3`, based on exact main `113772b66115c35c8899a8ce1e09a7986fdeade5` and tree `ca823ffef2325a2f26d4cef9ef582ef8ffe698ca`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 3. sec-static-convergence-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 4. candidate-control-transaction-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
