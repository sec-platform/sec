# Gift140: 非计算作者协议历史候选的类型化产品闭包范本（历史研究说明）

- **源语言**：`gift.author-module/2` 候选当时候选 Writer；旧 `/1` 和 `/2` 草稿字段只为历史只读兼容。
- **唯一产品根**：`gift.project.json` 的 `IDEProduct`。五个模块只按公开导出与作用域引用连接；不扫描全部工作区定义。
- **实际独立身份**：`EditorA` 与 `EditorB` 是同一个 `EditorComponent` 模板的不同实例，分别绑定两个独立的文档对象；`Storage` 是第三实例。`connections` 从 `Storage/FilePort` 到两个不同 Editor 实例的所需端口。
- **对外接口**：`publicEndpoints` 精确指向各个 Editor 实例的提供端口；它只声明产品公开契约，不签发 Grant。
- **部署**：`DesktopDeployment.nodes[].instance` 关联三个实际实例而不是组件模板；节点部署/复本数量需要后继 Method/Target 资格。
- **业务成员**：Editor 的状态、数据读写、事件发布、协议客户端、资源消费、UI、观测、并发、流程、政策、质量，以及 Storage 对应不同角色，均明确书写。有类型 `DefinitionUse` 共用角色绑定机制，不构成第28个 Definition Kind。
- **尚未获证**：锁定的外部 Issuer、领域 Meaning、公共宿主、规范联合求解、Provider/Grant、Method 和 Target 均仍是 Needs；原范本不是已生成 IDE。

原结构校验依赖 Python `jsonschema` + `referencing`。

校验器是**设计级**的受限 Linker 见证，不属于 Rust 产品 Reader、真实意义/权威解释器、Target 构建、供应资格检查器。所有异常测试都指向一个具体应拒绝的情况，不能用通用失败代签所有正确拒绝。

**接受记录演示的边界**：`--expected-hard goals:IDEGoal` 只是本地夹具独立指定的有限硬目标，并非真实客户接受记录。没有该参数的通常检查将保留 `NEEDS_AUTHOR_ACCEPTANCE_RECONCILIATION`；即使提供参数，也不证明角色/作用域细化与Norm一致。缺席的 optional 根或组件角色如果仍被局部成员要求，必须留下 `NEEDS_OPTIONAL_CONTEXT_VALUE`，不可用类型声明假冒一个真实对象。
