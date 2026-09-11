# SEC 公共文档库合同

本目录是 **Public Documentation Library / Documentation Experience** 的版本化源码候选层。

它的目标是把 SEC 已有的 canonical knowledge 以普通用户、开发者、架构师、贡献者和研究者能够理解的方式投影出来，而不是建立第二套产品或架构真值。

## 权限边界

```text
canonical domain truth
+ machine contracts
+ machine ledgers
+ maturity / Evidence
        ↓
audience-aware projection
        ↓
public-docs/**
        ↓
未来文档站 / 搜索 / 本地化 / 版本选择
```

硬约束：

1. 删除整个 `public-docs/**` 不得改变 SEC 产品语义、编译结果、Verification、Runtime 或 Support truth。
2. 公共页面与 canonical owner 冲突时，canonical owner 胜出；公共页面必须修正或失效。
3. 公共页面可以组合多个 owner 形成教程或指南，但不能重新拥有这些事实。
4. CLI、Schema、Config、Operation、Error/Reason Code、Support Matrix、Maturity 等可机器生成的 Reference 不应长期手抄第二份。
5. exact SHA、PR、run、当前 Work Package、当前 package version 等动态事实不能写死进稳定教程。
6. “设计存在”与 `implemented / verified / enforced / adopted` 必须分离；现实成熟度最终消费机器事实。
7. 教程必须包含失败、unknown、unsupported、stale、permission、recovery 和 migration 边界，不能只展示 happy path。
8. 原则必须说明现实依据、机制、适用范围、反例与反转条件；不能把一句口号写成不可质疑的 truth。
9. 文档站框架只是 Provider；Nextra、Fumadocs、Docusaurus、VitePress、Next、MkDocs 等不得取得 documentation semantic authority。
10. 不恢复已由信息生命周期治理退役的大段 archive、聊天或旧 Architecture Bible。

## Canonical 来源

每个公共主题从生成的文档导航 `docs/README.md` 定位 canonical owner，并引用其具体合同。
`docs/authority.json` 拥有 documentation identity/lifecycle/ownership；本目录不手工维护第二份 owner 清单。

## 读者模型

首个完整语言版本是简体中文，至少服务：

- 第一次访问者；
- 初学者；
- SEC 用户；
- 应用开发者；
- Brownfield 接入者；
- Public Contract / Port / Provider / Target 扩展作者；
- 构建、验证、迁移、发布和排障人员；
- SEC contributor；
- 架构师；
- 研究者。

Agent 的执行 authority 不来自公共教程。Agent 继续消费受治理的机器合同与开发投影。

## 信息架构

```text
开始
学习
原则与为什么
核心概念
架构
指南
Reference
故障排查
贡献 SEC
设计、成熟度与证据
术语表
```

公共导航按“读者要完成什么”组织；canonical docs 按唯一 owner 组织。两棵树允许不同构，但所有公共事实必须可追溯回 owner。

## 深度知识页面协议

重要页面应尽量回答：

```text
What        它是什么
Why         为什么存在
Reality     现实依据
Mechanism   怎样起作用
Alternative 竞争方案
Tradeoff    为什么选择当前方案
Scope       适用边界
Failure     怎样失败
Unknown     什么仍未知
Recovery    怎样恢复
Evolution   怎样升级/迁移/退役
Evidence    怎样证明
Maturity    现实做到哪一步
Implementation 去哪里看真实实现
Next        下一步读什么/做什么
```

## 原则记录协议

一个高价值原则至少应包含：

```text
Statement
Classification
Reality basis / Source
Assumptions
Mechanism
Scope
Non-goals
Strongest counterexample
Competing explanation
Weakening / reversal conditions
Derived consequences
Canonical owner refs
Machine enforcement refs
Evidence / maturity refs
```

逻辑约束、经验事实、产品价值、外部规范和工程 Evidence 必须区分，不能混成“自然真理”。

## Reference 与示例

Reference 的理想方向：

```text
machine contract
→ deterministic documentation projection
→ validation / readback
```

示例至少区分：

- teaching-example；
- executable-example；
- reference-workspace；
- negative-example；
- migration-example。

教学例子是 projection；可执行例子必须由真实命令和结果合同保护。

## 本地化

`zh-CN` 首先做到完整。后续语言版本应是同一知识 identity 的 localization projection，不建立平行 owner。API、Schema、ID、Error Code 保留精确英文机器标识。
