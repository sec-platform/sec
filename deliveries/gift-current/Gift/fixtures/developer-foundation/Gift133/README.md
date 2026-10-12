# Gift133：开发者全基础定义的多模块源码见证（不是生成的IDE）（历史研究说明）

本文记录原 Gift133 的**作者工程源形态**，用于检查提案 `gift.author-module/2` 的23类通用定义与既有 `gift.author-module/1` 六模态能否在 `gift.project/1` 的同一项目下有明确根选择和文件责任。项目叫 `gift133-ide-foundation-design`，模拟桌面编辑器的少量真实职责：文档/保存/状态/文件访问/UI/持久化/外部作用。**绝非完整VS Code功能全集，也没有真实桌面编译器或领域库**。

## 原案例的文件布局

```text
Gift133/
├── gift.project.json                  # Project/Target/真实根，仍为 /1
├── design/
│   ├── foundation.module.json        # 类型、纯计算、接口、状态机、事件、数据、资源（/2）
│   ├── platform.module.json          # 意义、文件效果、协议、权限、并发、观察、原生绑定（/2）
│   ├── interaction.module.json       # UI、长期保存流程、质量要求（/2）
│   ├── system.module.json            # 产品组件、系统、部署（/2）
│   ├── extensions.module.json        # 未安装扩展：必须保留Needs（/2）
│   └── goals.module.json             # 当前既有的 /1 六种意图，另选公开根
├── src/normalize-uri.ts               # 由作者真实维护的TS源码
├── supplies/
│   ├── unqualified-ide-meanings.json  # 原字节可核摘要的候选，不是领域解释器
│   └── README.md
├── constructor-matrix.json             # 19 Type/17 Expr/9 Query构造的结构实例
└── check_developer_source.py          # 只做离线结构/局部引用/负例；不生成任何代码
```

**不需要同时编写所有文件**：多文件只用于展示可维护的责任分区。`foundation`定义数据和计算；`platform`定义消息边界和真实文件效果需求；`interaction`是用户行为；`system`决定应用组成。旧 `goals.module.json` 的六种意图显式成为同一 `typescript-desktop` Target 的**第二个公开根**，不能因 `product:system.requirements` 为空就把这些Goal自动丢掉。`extensions` 文件虽是合法作者草稿，但不在Target根中；即使将来被选中也必须先取得外部Dialect资格。

## 原例的跨模块引用

`platform.module.json` 声明 `imports.foundation` 映射 `module:ide-foundation`；`FilePort` 输入使用 `foundation:SaveRequest`；它必须解析到 `foundation.module.json` 的**公开导出**。`system.module.json` 的 `EditorComponent` 通过 `foundation:EditorCommands` 和 `platform:FilePort` 组成；工作台/UI绑定和状态机通过相同符号合同相接。这些引用的类型/效果/目标/实际外部权限仍各自需要真正Consumer进行检查。原脚本只验证有限结构，不签发这样的产品资格。

一个跨域行为必须进一步满足：保存请求版本不可静默覆盖、异步保存失败可观察、文件实际状态由合格Observer读回、当前用户具有真实Grant、重复操作有明确幂等与对账。`SaveConcurrency.consistency="serializable"`只是作者要求；不证明任何Provider已经实现可串行化。`SaveWorkflow.recovery="manual"`明确未自动补偿，避免伪称撤销写入。

## 原有限检查的范围

原脚本使用 `schema/author/universal-author-module-2.schema.json` 作为设计级结构门禁，独立检查项目清单、带标签的定义Body、跨模块显式导入/公开导出、本地引用、状态转移、工作流有限依赖图、效果声明、整数Codec和本地TS源码符号，并对19类Type、17类Expr、9类QueryTerm逐构造验证结构实例，执行若干故意损坏的反例。它对旧 `/1` 模块调用原有有限Schema检查，但不声称已实现生产Reader。

**输出严格区分**：`LOCAL_SHAPE_VALID`=输入结构与有限静态规则通过；`needs` 明列未取得的旧Profile生产Reader、外部ImportLock、真实Meaning/Dialect消费者、Method、Target和观察资格；`production_qualified=false`永远不会被局部通过覆盖。这里不写入`gift.lock.json`、不创建假的 TypeScript 生成工程、不开外部Provider、无隐式部署。

`supplies/unqualified-ide-meanings.json`具有可以重新算出的SHA-256，供 `/1` 的`meaningImports`表达**内容完整性引用**；它明言`qualified=false`，摘要不是业务语义、事实真值、签名授权或资格证明。`ext:*`则表示另需真实供应/锁的未决引用，并不以臆造的外部定义假装本地已完成。

## 与权威规范的关系

- [开发者通用定义 Profile](../../../docs/20-语义与组合/作者语义/开发者通用定义Profile-类型计算业务与系统构造.md#developer-foundation-gift133)：唯一维护 `/2` 的类型、定义、语义、组合和拒绝规则。
- [结构化作者源码](../../../docs/10-作者与输入/作者源/结构化源码.md)：唯一写权、`/1`历史入口与多来源接受。
- [通用意图语言](../../../docs/20-语义与组合/作者语义/通用意图语言-意图源与语义组合.md)：已选六模态意图的真实语义Owner。
- [工程清单与锁](../../../docs/10-作者与输入/作者源/工程源/工程清单模块与绑定锁协议.md)：Project根、锁及Reader职责。

基础语义可以设计充分而产品尚未实现：这份范本没有真实 TypeScript Desktop 后端、没有合格EditorMeaning、没有生成IDE业务代码和独立运行验收。它是语言结构/作者角色的**有限可复现正例和反例**，不是产品成功见证。
