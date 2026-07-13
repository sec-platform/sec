---
name: sec-pr-closeout
description: "在 SEC PR 准备合并、被替代、需要关闭或仓库收口时，检查真实 diff、review、verification、authority 与清理动作；开发尚未进入收口阶段时不要触发。"
---

# SEC PR Closeout

本 Skill 不默认 PR 应当合并。先证明变化仍然有效、尚未进入 `main`，并且 required gates 完整。

## 审计

1. 重新读取 latest `main`、PR base/head、merge-base、ahead/behind 与真实 diff。
2. 检查 `main` 是否已通过 squash、其他 PR 或更完整实现包含同等产品结果。
3. 检查 PR state、draft/ready、mergeability、unresolved review threads、review submissions 与有效 `REQUEST_CHANGES`。
4. 检查 exact-head/current-base verification evidence、profile、contract revision、失效范围与未运行 Gate。
5. 交叉核对 authority、active Work Package plan、代码、测试和最终 changed paths。
6. 查找临时 probe、诊断日志、旧 snapshot、无意 generated artifact、retired workflow 或一次性入口。
7. 给出唯一结论：
   - merge-ready；
   - update/rebase required；
   - implementation fix required；
   - verification/review required；
   - superseded/absorbed；
   - obsolete/close without merge；
   - no-op，结果已在 `main`。

可并行委派 `repo-state-auditor`、`integration-reviewer` 与 `verification-evidence-reviewer` 做只读审查；Root A0 负责最终合并裁决。

## 合并

只有全部合并条件满足时才执行：

- 锁定 expected head SHA，防止审查后 head 漂移；
- 选择与历史噪声和仓库策略一致的 merge method；大型 integration 优先 squash 最终验证状态；
- 不把 Draft、mergeable 或部分绿色状态误写成 merge-ready；
- 工具权限或物理操作不可用时准确报告边界。

## 收口

合并、替代或放弃后：

1. 确认产品结果是否真实进入目标分支；
2. 更新/关闭对应 Issue 与废弃、镜像、probe、diagnostic PR；
3. 工具允许时删除完成使命的临时远端 branch 和 retired workflow；
4. 将 active Work Package 的长期事实归位到 authority，并归档或删除计划；
5. 重新读取新 `main`、开放 PR/Issue 和 CI 状态；
6. 最终报告区分“已确认完成”和“工具未执行/无法确认”的动作。
