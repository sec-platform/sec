# Engineering Compiler

SEC 是本地优先的 Engineering Workspace Compiler：把产品意图、结构化工程语义、受治理源码与既有工程证据，确定性地连接到实现选择、目标工程、验证、运行和演进。

SEC **不是**低代码运行时、模板市场、自由式整仓 AI 编码器，也不要求用户先学习或采用一门新的通用 `.sec` 语言。结构化作者源只维护与具体实现独立的产品决定；已经合格的 TypeScript、Rust、C/C++、Java、Python、Wasm、库、进程、设备或远端能力都可以作为直接实现供给。

Canonical 工程事实由各自 owner 维护：Engineering Semantics、源码、Evidence、运行状态、外部 Provider 与文档不会被复制进一个万能事实源。CLI、AI、IDE、HTML、图和报告只读取 canonical 事实或提交受限 proposal，不取得第二套 authority。

## 产品与作者

1. [产品与系统边界](docs/product.md)
2. [作者模型](docs/authoring-model.md) — Definition、Subject、Requirement、Project/Binding Lock、原生源码共存
3. [成品与消费边界](docs/deliverable-model.md) — Library、CLI、Service、Worker、UI、数据/模型/设备/部署等完整成品
4. [开发面](docs/developer-surface.md) — query/propose/preview/check/apply/operation 与编辑→构建→运行→调试
5. [可移植领域语义](docs/domain-semantics.md) — 计算、对象、状态、关系、流、事务、数值与随机语义

## 系统与实现

6. [SEC 系统架构](docs/system-architecture.md)
7. [Engineering IR 语义模型](docs/semantic-model.md)
8. [SEC 实现架构与意图编译](docs/implementation-architecture.md)
9. [编译器与目标 IR](docs/compiler-target-ir.md)
10. [运行时、依赖与分发](docs/runtime-and-distribution.md)
11. [变更、迁移与退役](docs/change-management.md)
12. [Verification 与 Evidence](docs/verification-governance.md)
13. [既有工程/Brownfield](docs/brownfield-import.md)
14. [外部 Provider 治理](docs/external-provider-policy.md)

## 信息、原则与人/AI协作

15. [工程信息模型](docs/information-model.md) — 单事实单权威源、typed relations、configuration/applicability/provenance与projection
16. [文档知识系统](docs/documentation-system.md) — stable owner source、registry、编译与生成视图
17. [设计演算与原则语言](docs/design-calculus.md)
18. [通用工程设计宪法](docs/engineering-constitution.md)
19. [通用 Agent 行为宪法](docs/agent-constitution.md)
20. [Agent 与用户机器接口](docs/agent-and-user-machine-interface.md)
21. [SEC 自主开发治理](docs/development-governance.md)

## Canonical 文档导航

[docs/README.md](docs/README.md) 是由 `docs/authority.json` 生成的 owner/index 投影。路径只用于稳定定位；产品、Domain、lifecycle、risk、team、release 等多维层级由 typed relations 和目的视图表达，不要求物理目录镜像语义世界。

Stable design 文档只描述当前采用的要求、机制、理由、失败/恢复、反例和真实未决，不保存逐轮修改日记或旧路径兼容。当前工作状态、Work Package 与运行 Evidence 由它们自己的 control/runtime owner 管理。

## 开发入口

从 [AGENTS.md](AGENTS.md) 进入 SEC 仓库自身的开发流程。仓库开发治理与 SEC 面向用户目标工程的 Developer Surface 是不同边界：前者负责本仓库的 Work Package / Git / Review / Gate，后者负责用户利用 SEC 开发实际软件。
