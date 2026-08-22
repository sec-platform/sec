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
    "manifestDigest": "sha256:78337f2908ef27b54600c377a51be5d5313326b9d323e4024b24160935b71fc8",
    "manifestPath": "docs/work-packages/generated-ignored-state-lifecycle-v1.md",
    "packageId": "generated-ignored-state-lifecycle-v1",
    "tracking": "issue-271"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "9373a36d4b4a5bb56cdf5fb05a613769c4231a74",
    "sourceManifestDigest": "sha256:78337f2908ef27b54600c377a51be5d5313326b9d323e4024b24160935b71fc8",
    "sourcePointerRevision": "sha256:e012a30a297f5441018ebd53f7ca51d789a2792502d49f2c4f05d280e52315fd",
    "sourceRollingRevision": "sha256:382b4640b396c75da7bac8eb8dd2eaa1e2c9a78ce6a5e51cf4ff75831d706dca",
    "sourceTree": "b6d2d92ef808e91740100ceaba9f3fac9d1973b7"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "git-worktree-physical-closeout-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "cf59ef7b1e166fa184592ab870fa5788466e2df9",
  "exactMainTree": "92fb08917f7bffac00e63ce64e2fd761ddeab7e8",
  "projectionDigest": "sha256:7b3080dbbbecee051a230760c42c3f7715b645494cf0863fab871c254d78ef20",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### generated-ignored-state-lifecycle-v1

Existing active package replan bound to exact source head `9373a36d4b4a5bb56cdf5fb05a613769c4231a74`, source tree `b6d2d92ef808e91740100ceaba9f3fac9d1973b7`, manifest `sha256:78337f2908ef27b54600c377a51be5d5313326b9d323e4024b24160935b71fc8`, and authority `sha256:84c6a14d482f30904557a2933c27df3771a4c95398dc3b0b19c931fd3cc1c140`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:84c6a14d482f30904557a2933c27df3771a4c95398dc3b0b19c931fd3cc1c140`.

### 2. git-worktree-physical-closeout-v1

Retained ordered candidate from transition authority `sha256:84c6a14d482f30904557a2933c27df3771a4c95398dc3b0b19c931fd3cc1c140`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:84c6a14d482f30904557a2933c27df3771a4c95398dc3b0b19c931fd3cc1c140`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:84c6a14d482f30904557a2933c27df3771a4c95398dc3b0b19c931fd3cc1c140`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
