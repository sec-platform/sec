---
name: sec-work-package-lifecycle
description: 创建、冻结、切换和归档 Work Package 与控制面；不把普通进度、路径映射或 Skill 偏好变成新包。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-work-package-lifecycle

## 触发
- Role=Integrator，operation=`plan | govern | integrate`，且存在真实交付闭包切换。

## 不触发
- 普通实现进度、单次测试、只更新 SHA；适用性不是 `applicable`。

## 输入
- current parser schema、base、owner/paths/resources、acceptance/tests、候选序列。

## 权限与路径
- 只写 Envelope 授权的 `docs/work/**`、manifest 和 archive。

## 允许工具与操作
- manifest parser、Git blob digest、docs-doctor、owner Census。

## 前置门禁
- 完整 Envelope；latest main/current parser已读取；新 manifest 已冻结。

## 执行
- 只使用 `codex-development-work-package-v1` 或受支持后继。
- pointer 绑定 staged Git blob digest；rolling plan 只保留当前包和二至五个候选。
- 新 manifest 原子接管 pointer 后才归档旧 selected manifest。
- 控制面变更运行 parser、digest、docs 和 owner 校验。

## 完成证据
- parser、pointer/path/digest、rolling binding、archive Census。

## 停止与恢复
- pointer、manifest、rolling plan 与 parser 完全一致。

## 禁止捷径
- 不虚构 schema，不让 pointer 指向不存在文件，不用 Skill 强迫创建包。

## 权威
- `docs/work/README.md`
- `scripts/codex/work-package-contract.ts`
