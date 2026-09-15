---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-16
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:f43a3f7dc0091200a0ec4f0d277fb9c0b445f2f0251387ed2d0c70f82c45a874",
    "manifestPath": "docs/work-packages/private-sandbox-python-runtime-transition.md",
    "packageId": "private-sandbox-python-runtime-transition",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "47f0c6a2607b310cb4bf53c47a4dd0aed073310b",
  "exactMainTree": "010e5b9c6619c74e1bd9dbdf6829a9a9aaa268f4",
  "projectionDigest": "sha256:bcf326bfd2572b9a808d82cc123db465bda0efc263083f3c66f6788b80494ea7",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### private-sandbox-python-runtime-transition

Proposal-only target manifest `docs/work-packages/private-sandbox-python-runtime-transition.md` at `sha256:f43a3f7dc0091200a0ec4f0d277fb9c0b445f2f0251387ed2d0c70f82c45a874`, based on exact main `47f0c6a2607b310cb4bf53c47a4dd0aed073310b` and tree `010e5b9c6619c74e1bd9dbdf6829a9a9aaa268f4`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 2. sec-static-convergence-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 3. candidate-control-transaction-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
