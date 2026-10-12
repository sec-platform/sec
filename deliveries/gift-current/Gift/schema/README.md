# 机器接口的位置与唯一权威

本目录保存**设计阶段的结构化协议草案**，不是当前已发布的生产Reader/编译器或测试集合。文件名末端 `/1`、`/2` 表示相应接口的解码版本；业务定义、Role、ComponentUse、Target等对象**不因此需要重复填写协议版本**。不同接口版本只在实际接口使用点选择；业务身份、作者修订与供应锁的精确内容不是同一个版本号。

## 开发者现在写哪几个文件

项目范围与Root选择只有 [`source/project-1.schema.json`](source/project-1.schema.json) 的 `gift.project/1`：必需键为`schema/projectId/sourceScopes`，可选`targets/defaultTarget/annotations`。模块定位从SourceScope读取到的真实文件派生，不再手写`modules`；不接受顶层`extensions`、`policyRequests`。没有选中目标也可保存合法设计。

开发者的结构语义文件只写 [`author/universal-author-module-2.schema.json`](author/universal-author-module-2.schema.json) 的 `gift.author-module/2`：必需`schema/moduleId/definitions`。27类Definition统一在它的`Definition.oneOf`中：业务、计算、意图、Pattern、Requirement、产品都属于同一候选语言，普通模块不强制写空`dialects/imports/exports`。每种Kind的真实解释、依赖和不完整结果由[作者语义Owner](../docs/20-语义与组合/作者语义/开发者通用定义Profile-类型计算业务与系统构造.md#business-kind-consumer-coverage)负责；`x-gift-*`机器元数据只是当前设计辅助说明，不是第二份可写语法或者实现资格。

作者确实需要独立稀疏控制时，用 [`controls/control-file-1.schema.json`](controls/control-file-1.schema.json) 的有型 ControlFile，由同一个Project的 SourceScope发现；它不要求一个额外的`project/2`注册清单。已有原生实现绑定的作者选择可依据 [`source/native-binding-selection-1.schema.json`](source/native-binding-selection-1.schema.json) 单独提供；来源代码的唯一编辑权仍归原生文件，不写镜像计算AST。

## 供应者、Resolver与目标的协议并非业务Writer

- [`source/binding-lock-1.schema.json`](source/binding-lock-1.schema.json)是解析器生成的精确Occurrence→内容节点绑定，不能由作者手工填伪哈希；内容Digest、来源revision、版本声明、外部Grant和运行Settlement分别成立。
- [`author/author-dialect-supply-1.schema.json`](author/author-dialect-supply-1.schema.json)是非内建扩展语义的供应者合同；它声明签名、版本与真实消费者的条件，并不允许项目内任意JSON字典获得语义资格。
- [`supply/method-supply-1.schema.json`](supply/method-supply-1.schema.json)和[`supply/target-profile-1.schema.json`](supply/target-profile-1.schema.json)分别是实现方法和目标平台的供应声明；它们与作者表达、外部授权、真实编译成功互不替代。

开发者不需要在每个Definition上复制任何这类解析、布局或运行时记录。一个ProductRoot是否满足业务硬要求，需要从真实被接受的Requirement与实际供应联合求解，不能靠源文件包含声明字段判断。

## 只在相应专业消费时使用的窄体结构

- [`requirements/requirement-structure-1.schema.json`](requirements/requirement-structure-1.schema.json)：原RequirementTerm八种组合及其历史独立Body；当前作者容器的`req:composite` Body以唯一 `/2` 定义约束为入口，历史Body不能作为第二个新Writer。
- [`semantics/intent-body-1.schema.json`](semantics/intent-body-1.schema.json)：历史六模态的精确含义参考，当前`intent:goal`由同一 `/2` 的Body及[意图Owner](../docs/20-语义与组合/作者语义/通用意图语言-意图源与语义组合.md)联合解释，不因为旧Schema存在而新建Intent Module写源。
- [`semantics/semantic-pattern-1.schema.json`](semantics/semantic-pattern-1.schema.json)、[`semantics/semantic-pattern-use-2.schema.json`](semantics/semantic-pattern-use-2.schema.json)：Pattern定义和实例化的可复用字段研究；最终以 `/2` 的内嵌Definition和Pattern专业语义唯一写源为准，旧Use `/1`保留只读。
- [`semantics/rule-call-observation-2.schema.json`](semantics/rule-call-observation-2.schema.json)：业务谓词被观察、三/四态结果与进展观察的专属Body设计；不能把观察结果Bool化或用一个Ref冒充现实事实。
- [`semantics/intent-local-replanning-contract-1.schema.json`](semantics/intent-local-replanning-contract-1.schema.json)：有界模型中重新规划的派生运行投影；它的有限前提不能提升成现实领域已被观察或任意软件重新规划可自动完成。

## 开发者工具协议各按实际调用使用

`tools/query-2`（查询）、`propose-2`（提出变更）、`check-2`（资格查询）、`preview-2`（预览）、`apply-2`（正式采用/修改）、`operation-2`（真实执行边界）分别拥有自己调用体，`structured-files-1`、`generated-edit-1`和`result-view-2`是按需协商的负载或呈现格式，**不是业务作者源中的九种新Definition**。这些是接口设计参考，本轮不实现工具或检查器。具体权限、会话、写入和结果的真实Owner在[开发者工具与交付](../docs/80-开发者与接口/README.md)。

## 隔离的旧机器结构与研究投影

原`semantics/intent-module-1`、`intent-module-mixed-1`是`gift.author-module/1`历史四类声明的有限容器；`semantic-pattern-use-1`是已被更精确基数绑定替代的旧版本；`intent-meaning-library-1`、`intent-model-supply-1`、`intent-finite-model-1`是封闭模拟数据格式；`design-compiler-closure-witness-1`只属于旧交付门禁实验。它们保持为**历史兼容及来源研究**，不能被当前新业务模块选作Writer，也不能据其内部检查名称推断任何语义/目标/执行资格。

`general-semantic-role-index-1.json`与`design-schema-catalog.json`若存在，只是旧研究派生索引；唯一角色/职责语义在[工程通用语义](../docs/20-语义与组合/共同语义/工程通用语义全域与闭合合同.md)，唯一Schema内容在本目录各实际JSON协议。任何索引不得要求作者维护或成为拒绝当前新业务源码的额外规则。

在这一工作阶段，**文档逻辑推导是设计工作，开发检查器、负例自动程序、编译器、CI和性能验收不在范围内**；故本文不列运行命令，也不拿测试数量作为设计完备性论据。
