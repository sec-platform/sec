---
name: sec-trust-root-bootstrap
description: 用于候选修改 verifier、Hook、test-impact、Gate、Evidence parser、merge authority、package/toolchain等信任根时，以受信 base 独立验证并完成 epoch 切换；不用于普通产品改动。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-trust-root-bootstrap

## 触发
- candidate改变当前 trust-root文件或验证选择/授权语义。
## 不触发
- 普通产品叶节点且现有 trusted verifier可完整验证。
## 输入
- trusted base verifier、exact candidate、独立 Review、focused/TCB证据、manual bootstrap计划。
## 执行
1. candidate不得用自身新增规则授权自身。
2. 使用 base-side parser、scope、focused contracts和TCB closure审查candidate。
3. 记录哪些 hosted Gate按设计会返回 `manual-bootstrap-required`，禁止重复制造绿色。
4. admin/manual integration后读取新 main。
5. 返回 `TASK_RESTART_REQUIRED`，新任务重新加载 exact trust root。
## 停止条件
- 新 trust epoch进入main并由新会话重新信任；否则保持阻塞。
## 禁止捷径
- 不把静态Review当物理测试。
- 不在同一epoch边修内核边继续产品开发。
## 权威
- `docs/test-feedback-and-ci-lanes.md`
- `scripts/codex/merge-gate.ts`
- `docs/governance/agent-skills-and-development-run-kernel.md`
