---
name: sec-failure-recovery
description: 当确定性 failure owner 仍不能唯一解释根因时，裁决 root-cause class、owner 与下一类恢复动作；不直接执行 recovery、proof reset 或状态迁移。
---

# sec-failure-recovery

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：exact failure/input/epoch/cleanup 已由机器 owner绑定，但根因仍有多个可信解释；或同类失败重复，需要判断 leaf、shared contract、architecture、provider/environment 或 external blocker。
- 不适用：failure fingerprint 已映射到唯一 remediation/next transition；只是等待已知 in-flight Action、结果尚未完成或单次性能离群。

## 已准入输入
- 仅使用 Read Plan 给出的 exact failure/fingerprint、failure tail、old/current epoch、input delta、owner/invariant、cleanup/settlement 与 causal Evidence。
- 不搜索 Memory、dangling objects、历史 PR/Issue、所有日志或第二 Skill；缺 Evidence 返回 `evidence-needed`。

## 判断职责
1. 建立最少竞争解释：产品实现、合同/owner、Review/scope、environment/provider、stale identity、external mutation 或 unknown。
2. 用已准入 Evidence 排除解释，优先共同原因而不是再次 leaf patch。
3. 裁决下一类动作：`reuse-failure | minimal-rerun-after-causal-change | proof-reset-request | architecture-recalculation | external-blocker | unresolved`。
4. 指出失效的旧 Evidence/epoch；真正 reset/recovery/rebind 交回其机器 owner。

## 判断输出
- `failureJudgement`：rootCauseClass、owner/invariant、被排除解释、invalidated Evidence、nextActionClass、决定性未知与反转条件。

## 停止与回退
- root cause 与下一类机器动作已唯一时停止。
- Evidence不足返回 bounded unresolved；输入未变化时不得建议重复尝试。

## 禁止
- 不因失败删测试、降 assertion、扩 timeout、反复 rerun 或新建 candidate。
- 不默认恢复用户/maintainer 已改变的状态，不用 `git fsck`/dangling-object resurrection 代替 authority。
- 不把 Skill judgement 写成 recovery Effect receipt。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/development-governance.md`
- `docs/verification-governance.md`
- 当前 failure 对应的 canonical owner / Result / recovery contract
