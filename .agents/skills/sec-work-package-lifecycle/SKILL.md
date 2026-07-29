---
name: sec-work-package-lifecycle
description: 用于创建、冻结、切换和归档 SEC Work Package 及三控制面；不用于把普通进度写成新包或把仍被 pointer 引用的 manifest 提前归档。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-work-package-lifecycle

## 触发
- 新正式交付闭包、真实 `reload_if`、当前包完成/废弃或下一个包接管。

## 不触发
- 普通实现进度、单次测试结果、只更新 SHA 的 post-merge pointer patch。

## 输入
- current parser支持的 manifest schema、base、owned/forbidden paths、acceptance、tests、rolling candidates。

## 权限与路径
- 只写docs/work/**、selected/new manifest及经manifest声明的归档路径。

## 允许工具与操作
- manifest/parser、Git staged blob digest、docs doctor、ownership census。

## 前置门禁
- latest main与current parser已读取；下一个包切换时新manifest已冻结。

## 执行
1. 只使用 `codex-development-work-package-v1` 或 `codex-development-work-package-v2`。
2. 计算 staged Git blob bytes SHA-256，并更新唯一 active pointer。
3. rolling plan保持一个 active package和连续、唯一的二至五个候选。
4. selected manifest进入 default branch后 resolver可返回 `matchingDefaultBlob: none`，但仍被 pointer 引用的 selected manifest 必须继续保留。
5. 只有下一个 manifest原子接管 pointer后，旧 selected manifest才可移入 archive。
6. 每次控制面变化运行 parser、docs doctor、ownership和digest校验。

## 完成证据
- parser PASS、pointer/path/digest、rolling plan binding、归档census。

## 停止与恢复
- pointer、rolling plan、manifest path/digest和parser完全一致。
- pointer/manifest漂移即停止；不得先移动selected manifest再修pointer。

## 禁止捷径
- 禁止 `sec-work-package-manifest-v1` 等虚构 schema。
- 禁止 pointer 指向不存在文件或不受支持的显式 `none` 状态。

## 权威
- `docs/development-governance.md`
- `docs/work/README.md`
- `scripts/codex/work-package-contract.ts`
- `scripts/codex/document-control-plane-contract.ts`
