# Gift 94 — 具体控制、来源和阶段合同（设计样例）（历史研究说明）

原实验目录**不是可发布的 Gift runtime**。其唯一目的是把现有控制合同落实成可以独立读取和测试的机器形状，供 `contracts / workspace / resolver / target` 的真实开发者接受或修订。所有 `example.*` 均为范例域标识，不能称为产品已发布的控制项。

- `schemas/gift.control-records-2.structural-proposal.schema.json`：现有 `gift.controls/2` 的严格结构子集。
- `schemas/gift.control-descriptor-catalog-1.proposal.schema.json`：新增 descriptor 物理提案，保留 93 版所要求的 12 种合同信息。
- `catalog/example-descriptors.json`：十个带精确值域、范围、consumer、验证和失效声明的设计例子。
- `01-structured-project/gift.project.json`：使用**现有 `gift.project/1`** 的持久作者源；七条控制，真实五个结构作者模块。
- `01-structured-project/simulation-input.json`：有限 Method 候选/上下文的**测试见证**，不纳入作者项目事实。
- `01-structured-project/runtime-invocation.example.json`、`client-preferences.example.json`、`observations.example.json`：独立 authority 的**演示对象**，绝不复制到项目 `controls`。
- `verify/evaluate_controls.py`：确定性有限域**示例求值器**；它不会解析真实 Requirement，也不会生成 TypeScript、运行、写源码、恢复外部效果或签发等价保证。
- `verify/test_contract.py`：36 项严格值、目标限定、作用域、偏好/硬冲突、候选过滤、权限隔离的正反测试。

原实验入口： `fixtures/author-workspace/Gift94/verify/test_contract.py`，或者原实验的 unittest 入口。原实验依赖 Python 3 和 `jsonschema`（校验器**不自动联网安装依赖**）。

**实现前阻断**：`ts.profileRef=example.typescript.target-profile/1` 尚未解析绑定；`req:rule` 完整机器 body 合同仍需原 owner 发布；原生方法供给、Target/Provider、运行和独立 Assurance 仍需真实产品代码。这不阻止设计阶段读取已固定的源文件。

- `schemas/gift.control-mutation-1.proposal.schema.json`：按逻辑键修改候选的非公共 wire 草案。
- `01-structured-project/control-edit.candidate.example.json`：一批 `set` 与 `reset`，只得到未保存的候选。
- `verify/evaluate_controls.py::propose_control_mutation()`：内存候选实现，不替代 Workspace 的多文件事务、权限或外部效果。

现行控制写源与迁移按[稀疏控制 Owner](../../../docs/20-语义与组合/组合/稀疏控制与目标限定.md)解释。本文保留旧版形状的研究含义，不延长旧 writer；旧 `rootRef` selector 只有唯一匹配才可迁为现行 root occurrence，不能把历史记录改成新字段后声称原案已采用。
