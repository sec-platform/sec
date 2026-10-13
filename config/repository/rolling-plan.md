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
    "manifestDigest": "sha256:95315c1c3a0aa361548f76f1237a43fbf8996af1959554aca1ed283bb6e62e7d",
    "manifestPath": "config/repository/work-packages/main-source-health-repair-20261013.md",
    "packageId": "main-source-health-repair-20261013",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [],
  "exactMain": "fa80716ab04ef697116ea9457f1ce0913e23acf5",
  "exactMainTree": "b7fb519379d69c50249ad706a39e7133a455392f",
  "projectionDigest": "sha256:f3c3b8cd3a7503128183f85b71719ab00cd05821f768e725cc1f6a19d66e8312",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### main-source-health-repair-20261013

Proposal-only target manifest `config/repository/work-packages/main-source-health-repair-20261013.md` at `sha256:95315c1c3a0aa361548f76f1237a43fbf8996af1959554aca1ed283bb6e62e7d`, based on exact main `fa80716ab04ef697116ea9457f1ce0913e23acf5` and tree `b7fb519379d69c50249ad706a39e7133a455392f`.

## 候选 Work Package


## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
