---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-13
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:5b0fddc4c8b38d38ac43bb77b1b36acfb69f9e928a687f41f61516a264e87e85",
    "manifestPath": "config/repository/work-packages/main-health-hosted-recovery-20261013.md",
    "packageId": "main-health-hosted-recovery-20261013",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [],
  "exactMain": "0536dca0da634fe26fe175bc4694883f966ae356",
  "exactMainTree": "6435d35751e2293410eed80cbb3eb013f02afb11",
  "projectionDigest": "sha256:1a6ce45503e4849e8717496ee511964989af986bd6976e881dd8a4a7bd59874b",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### main-health-hosted-recovery-20261013

Proposal-only target manifest `config/repository/work-packages/main-health-hosted-recovery-20261013.md` at `sha256:5b0fddc4c8b38d38ac43bb77b1b36acfb69f9e928a687f41f61516a264e87e85`, based on exact main `0536dca0da634fe26fe175bc4694883f966ae356` and tree `6435d35751e2293410eed80cbb3eb013f02afb11`.

## 候选 Work Package


## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
