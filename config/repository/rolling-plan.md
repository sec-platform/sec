---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-01
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:08db3a28934f316c15e8e454df1b5a6ca59495e01661427f9764e000d02bfa0b",
    "manifestPath": "config/repository/work-packages/document-control-roles-20261001.md",
    "packageId": "document-control-roles-20261001",
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
  "exactMain": "f400359d0b59acfe434ba59373ca7732b2cc2938",
  "exactMainTree": "6a2203d61fefd2453f227fc02562a8cfff58e95b",
  "projectionDigest": "sha256:3cd5e1f6eebe74b6dbc62adca9aef7baa14e91d7dc41c83b7b13bb80ee43fd1f",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### document-control-roles-20261001

Proposal-only target manifest `config/repository/work-packages/document-control-roles-20261001.md` at `sha256:08db3a28934f316c15e8e454df1b5a6ca59495e01661427f9764e000d02bfa0b`, based on exact main `f400359d0b59acfe434ba59373ca7732b2cc2938` and tree `6a2203d61fefd2453f227fc02562a8cfff58e95b`.

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
