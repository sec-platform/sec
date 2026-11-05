# 共享基础源码与外部边界

最新归属纠正：当前native-*.selection.json仍指向本任务手写的native-support包装，这是待退出的候选接合，不是最终供给。标准库/外部声明须改接真实ImportedModuleView；语言内建及必要helper由合格Target派生；组合逻辑留在Gift。相关门面和共同借用合同正在统一重算，不能按下方文件存在宣称已完成导入或降低。

FNV 的唯一当前作者源是 [globset/fnv.module.json](../globset/fnv.module.json)，逻辑身份为 ripgrep:globset:fnv。它包含实际状态更新和 Default/Hasher 实现体，消费真实 u64 异或、环绕乘法及标准 HashMap。旧 fnv.gift 只是纯数学值模型，不再作为同身份作者模块；它的准确前像保留在本任务 .tmp/whole-engineering-20261025/wave2/retired-author/fnv.gift，SHA-256 为 15156ac986cd57619ed4194b08991e02ed7c29621d3999ba7245549621a3d28a。完整类型、trait、目标成本和运行资格仍未取得，见 [globset 来源与缺口](../globset/GLOBSET-SOURCE.md)。

当前共享文件各有实际且有限的责任：

| 作者入口 | 输入与责任 | 仍未取得的资格 |
| --- | --- | --- |
| [place.module.json](place.module.json) | 共同 Borrow/BorrowMut 构造器及有限 InterpretPlace 声明：字段类型、字段借用、消费字段与整值短借用；无原生wrapper依赖 | 生产 Reader、类型与借用检查和 Rust 降低；构造器/字段/清理表示见证不得由名字推断 |
| [machine.module.json](machine.module.json) | 重导出准确机器、容器、迭代器、标准 trait 和有资格的 place 操作 | 数学 Int/Sequence 与原生标量/Vec 的完整表示关系、静态文本/字节存储、全部公开调用点的类型证明 |
| [path.module.json](path.module.json) | 平台共有的 Path/OsStr 表示及标准操作；Unix/Windows 专属导出分别位于 path-unix/path-windows | 平台选择、Unix 运行、完整 SourceProfile 和使用点资格；不包含 ripgrep 自有路径算法 |
| [format.module.json](format.module.json) | 实际 std formatter 与保留其借用的 debug builders，直接 Display 与嵌套格式化分别暴露 | 项目类型的真实 Display/Debug witness、旧调用点的借用/参数适配、具体目标绑定 |
| [text/conversions.module.json](text/conversions.module.json) | 已有有限标量 UTF-8、ASCII 与两位 hex 算法 | 其余 Text 入口、分类/trim、StrToScalars 等跨表示接口；见 [文本来源](text/SOURCE.md) |

仍保留的 native-*.selection.json 指向相邻 [native-support](../../native-support/README.md)，仅作为待退出候选。memchr 已改用[直接导入画像](IMPORTS.md)的锁定真实 crate 视图，原 native-memchr selection 不再属于作者输入。compiler/Profile 仍拥有导出角色、泛型顺序、关联类型、寿命、cfg 和实际类型身份。完整 Profile/Target 装配尚未写成可消费的最终输入；选择文件或导入声明存在不证明已导入、已生成或已运行。

Borrow/BorrowMut 的 Gift 头为 Type、Region，由共同解释形成类型；Rust Target 的真实引用表示不经 native-support 别名取得。WithBorrow、WithBorrowMut、WithSharedBorrow 同样不再绑定手写helper。其余门面仍在迁移：VectorIter、VectorIntoIter、HashMapIntoIter 和 IntoIterator 各是类型/trait，迭代器操作是 callable，不能混用；Pair 的真实 tuple 表示、稳定 Vec::sort 与 SortUnstable 的区别须由最终直接导入/Target保持，当前wrapper映射本身不签发资格。

这些门面不包含项目规则、格式决定或整个算法的 native 回调。SOURCE 表是导航与未决说明，不是第二套签名注册表；函数合同由真实作者声明、native 编译器类型图和唯一规范 owner 共同消费。完整工程及尚缺的接口继续以根 [README](../../README.md) 和各片来源说明为准。
