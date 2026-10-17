# 设计协议的机器载体

本目录是规范的结构化设计载体，采用不等于已有生产 Reader、迁移器、编译器或 Target。格式版本选择解码合同，准确 Schema 内容修订、作者身份、依赖内容与当前作用权限分别绑定。现有 `/1` 工程仍按[工程源合同](../docs/作者/工程源/清单模块与绑定锁.md)读取，只有完成已授权迁移与消费者切换后才使用后继 Writer；不得以这里出现 `/2` 覆盖旧合法输入。

| 载体 | 唯一责任与正文 |
|---|---|
| [Project /2](source/project-2.schema.json) | `schema/projectId/sourceScopes`，可选目标及非语义说明；[源发现、根发生点与完整迁移](../docs/作者/工程源/清单模块与绑定锁.md#successor-author-project-contract) |
| [作者模块 /2](author/universal-author-module-2.schema.json) | 有类型 Definition 容器；[语义、Use/实例与组合](../docs/作者/结构化源码.md#successor-unified-author-definitions) |
| [共同语义结构](author/shared-semantic-structure-1.schema.json) | 现行 TypeTerm、Kind/参数包、Expr/Pattern 与闭合构造；[共同结构 Owner](../docs/作者/组合/结构编辑与身份保持.md#类型项) |
| [Requirement Body](requirements/requirement-structure-1.schema.json) | 复用共同结构，保留类型实参、定义值、设计表达式、动态 design-use 与闭合默认；[结构化作者 Owner](../docs/作者/结构化源码.md) |
| [Intent Body](semantics/intent-body-1.schema.json) | [原需求本义、一等引用、六模态及有限公式/量化/时态](../docs/作者/需求含义与实现责任.md#intent-goal-author-definition)；领域、观察和时间资格另判 |
| [ControlFile /1](controls/control-file-1.schema.json) | 后继逻辑控制的唯一持久位置；[范围、全局键、捕获及提交](../docs/作者/组合/稀疏控制与目标限定.md#successor-control-file) |
| [PackageManifest /1](library/package-manifest-1.schema.json) | 按需发行描述；[完整库字段与单写迁移](../docs/作者/组合/模块封装与复用库.md#successor-package-manifest) |
| [绑定锁 /1](source/binding-lock-1.schema.json) | Resolver 产生的发生位置→内容节点，不是作者手填事实 |
| [原生符号选择 /1](source/native-binding-selection-1.schema.json) | 选择准确 Profile 与已有原生导出，原函数体和观察签名不复制 |
| [方言供应 /1](author/author-dialect-supply-1.schema.json) | 解释、类型、效果、组合、迁移与证据义务的专业供应声明，不自签执行资格 |

作者模块的意图、Pattern、PatternUse 与 Requirement Body 通过各自 `$id` 引用专业 Schema。验证端必须显式登记本次选定的完整本地 Schema 集与准确字节，不能通过网络按同名获取“最新”合同。未取得外部 `$ref` 时是依赖缺项，不能改为接受任意 JSON。新增专业载体各消费其正文 Owner，不由本索引产生第二份语义。

Schema 不能独立检查：重复 JSON 键的原文、文件对象与路径安全、冻结成员覆盖、跨文件逻辑键、模块/公开名/角色存在性、名义类型、单位、四态证据、权限、联合可满足性、Method/Target 资格、真实外部效果或恢复结算。严格解码、SourceOwner、Linker、专业语义、运行与 Evidence 分别承担这些责任；JSON 校验通过不能提升证明强度。

后继正例及第二次修改见[最小持久作者工程](examples/author-v2/README.md)。例子只使用设计协议，保存合法作者源不证明生成或执行。

[Requirement 组合正例](examples/requirement-composition-v2.module.json)另外覆盖共同 core:Int、闭合默认表达式、准确 design 定义值及动态 design-use。Plan 的显式参数 limit 由固定纯表达式 2+1 得到；第二次将该处右字面量由 "1" 改为 "3"，只改变该 Use 的 limit 为 5，不修改 Policy 的默认 3 或其他 Use。空 terms 是合法无附加义务，绝不以此声明实现任何业务功能。该样本仅校准结构与身份/默认分工，阶段、类型与真实 Reader 资格分别取得。
