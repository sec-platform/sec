---
name: sec-repository-audit
description: 在确定性 exact-tree census 已提供完整覆盖事实后，对跨模块/owner/验证/恢复表面做开放式因果审计与遗漏轴判断；不负责普通 orientation 或用模型阅读代替全仓 census。
---

# sec-repository-audit

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：用户要求真正系统级审计且 deterministic audit owner 已提供 exact tracked-path census/分类/owner/entrypoint/unknown 基线；或重复系统缺陷需要开放式因果解释。
- 不适用：只需 main/PR/Issue/CI/Review snapshot；frozen leaf implementation已有明确 owner/scope；deterministic census 尚未完成。

## 已准入输入
- 仅使用 Read Plan 给出的 exact revision census、tracked-path classification、authority/owner/entrypoint graph、known findings/unknowns、test/physical Evidence 与产品 Goal。
- 需要新增证据时输出 explicit frontier，不把搜索命中、README、Memory、旧报告或所有 Issue 当输入。

## 判断职责
1. 从 census 建立对象、状态/写 owner、入口、生命周期、数据/控制流、failure/recovery 与 publication 的因果模型。
2. 寻找第二 writer/loader/revision/pipeline、隐式状态、孤儿 consumer、重复规则、错误成功声明、不可恢复路径和测试证明空洞。
3. 为每个 finding 给出机制、影响半径、最强替代解释、决定性 Evidence 与反转条件。
4. 区分 leaf/shared-contract/architecture/heuristic/provider/verification-data-quality 问题，只路由相应 owner，不把所有 finding 塞进一个实现包。

## 判断输出
- `auditJudgement`：exact census ref、覆盖边界、finding/unknown ledger、root-cause clusters、owner routing、优先依据和下一证据/工作闭包。
- “未发现”必须绑定检测机制和已覆盖轴。

## 停止与回退
- 决定性轴已覆盖且继续攻击不再产生新的高影响解释时停止。
- exact main/authority/census 变化使旧审计 stale；从新 deterministic census 重算。

## 禁止
- 不用 `rg`/代码搜索/单图/抽样目录冒充全仓覆盖。
- 不把审计报告提升为产品/架构 authority，不把全部 findings 合并成巨型 PR。
- 不自行预读全 Skill corpus、所有文档或所有 Issue 来建立“熟悉度”。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/authority.json`
- `docs/development-governance.md`
- `scripts/codex/repository-audit.ts`
- 当前 finding 对应的 canonical domain owner
