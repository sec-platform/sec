---
name: sec-documentation-governance
description: 用于创建、修改、归档或审计 SEC 任意 Markdown、文档权威、链接、frontmatter和三控制面；不用于把历史材料重新提升为当前事实。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-documentation-governance

## 触发
- 任意 tracked Markdown新增、移动、删除或语义变更。
## 不触发
- 只读历史研究且不改变仓库。
## 输入
- 文档路径、status、canonical owner、Skill coverage、显式链接、active pointer。
## 执行
1. 每个Markdown先分类为 Skill、活动权威、frozen Work Package、Evidence或历史。
2. 活动权威只保存稳定事实；动态事实进入三控制面；历史进入archive/evidence。
3. 含Agent执行判断的活动文档必须映射至少一个Skill；Skill只投影，不复制authority。
4. 校验frontmatter、唯一H1、Unicode、链接、deprecated token、pointer/manifest binding。
5. 运行 `bun run docs:doctor`和Skill coverage合同。
## 停止条件
- 全部Markdown分类且活动启发式表面有Skill owner，docs零error。
## 禁止捷径
- 不创建无证据“分析报告”。
- 不保留机器绝对路径、动态计数或与当前事实冲突的旧口吻。
## 权威
- `docs/00-文档索引与一致性规则.md`
- `docs/scripts/docs-doctor.ts`
- `docs/governance/agent-skills-and-development-run-kernel.md`
