---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-21
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "schema": "sec-work-rolling-proposal-projection-v1",
  "exactMain": "85de472a4284b26565602d2b85bbdb04cc990c77",
  "exactMainTree": "2a66008c95fd31f2adb4dc844bffeb4c40988c52",
  "authority": "none",
  "active": {
    "packageId": "sec086-current-main-convergence-v1",
    "tracking": "none",
    "manifestPath": "config/repository/work-packages/sec086-current-main-convergence-v1.md",
    "manifestDigest": "sha256:eebbe7996c800733342dc88725ec3917c00946604c4a6ab044de2c448f5924c1"
  },
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "projectionDigest": "sha256:8ae25df97ffa08b3d96d2ce9551956c70f4138411d73b0dd4a380426d0dda270"
}
```

## 当前唯一 Work Package

### sec086-current-main-convergence-v1

Proposal-only convergence manifest `config/repository/work-packages/sec086-current-main-convergence-v1.md` at `sha256:eebbe7996c800733342dc88725ec3917c00946604c4a6ab044de2c448f5924c1`, based directly on current public main `85de472a4284b26565602d2b85bbdb04cc990c77` and tree `2a66008c95fd31f2adb4dc844bffeb4c40988c52`.

It exists only to integrate the already-developed SEC-086 tree into the current main generation. It does not turn the historical architecture branch, commit count, or transport refs into progress authority.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained active-critical-path candidate from the canonical Work Selection catalog; no selection authority is implied.

### 2. operation-read-plan-authority-canary-v1

Retained product-critical-path candidate from the canonical Work Selection catalog; no selection authority is implied.

### 3. sec-static-convergence-v1

Retained product-critical-path candidate from the canonical Work Selection catalog; no selection authority is implied.

### 4. candidate-control-transaction-v1

Retained product-critical-path candidate from the canonical Work Selection catalog; no selection authority is implied.

### 5. typescript-7-checker-acceleration-v1

Retained near-term acceleration candidate whose prerequisite remains the Operation Read Plan work; no selection authority is implied.

## 重新规划硬触发器

1. exact main、work-selection catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。由于本次是全仓convergence，正式冻结后的RequiredClosure可能是full；本文件不将尚未运行的验证写成PASS。
