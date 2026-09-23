---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-23
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:1c36f1ae38441621a0f6aa96b25e43fc5a14a3278679b369f33085a0fe3ac020",
    "manifestPath": "config/repository/work-packages/coordinated-repository-closeout-v1.md",
    "packageId": "coordinated-repository-closeout-v1",
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
  "exactMain": "8c6dc289e3fe17b358e6a9c335fbbe092b8ce1ce",
  "exactMainTree": "52b96737f3f3983347738fe4fec11a89e76dc92c",
  "projectionDigest": "sha256:e3dc10e4082adc961d61277111d494c4c29fb07f7a1d21cb8c48f8b12bcd5116",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### coordinated-repository-closeout-v1

Proposal-only target manifest `config/repository/work-packages/coordinated-repository-closeout-v1.md` at `sha256:1c36f1ae38441621a0f6aa96b25e43fc5a14a3278679b369f33085a0fe3ac020`, based on exact main `8c6dc289e3fe17b358e6a9c335fbbe092b8ce1ce` and tree `52b96737f3f3983347738fe4fec11a89e76dc92c`.

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
