# ripgrep：完整混合 Gift 作者工程设计

本例把成熟外部工程 **ripgrep 的整个作者工程**放进 Gift 设计：`rg`、九个库、Cargo 依赖、构建与发行配置、测试、fuzz、benchmark、许可证和资产全部保留。它交付两份可实际装配的完整作者实例、准确接合、模型与实现的保持关系，以及全工程逐项审查。

**这是完整混合作者工程设计，不是整个 ripgrep 已转换为纯 Gift，也不是已能由生产 Gift 编译器构建的成品。** 原生 Rust 仍是主要的可编辑作者源码。本次真正迁出的区域只有 Unix 最终路径分量算法；没有把原生源码、实现供给或维护资产移出分母来宣称大幅精简。生产 Reader、链接/类型/效果检查、方法资格、Rust Target 与受管回源尚未实现/执行，具体未验证项见 [EQUIVALENCE.md](EQUIVALENCE.md)。

## 实际交付与选择理由

| 文件或目录 | 责任 |
| --- | --- |
| [gift.project.template.json](gift.project.template.json) | 创建实例时原样保存为`gift.project.json`；声明实例源范围和十个产品根，原生源、设计、资产与模型分别保留作者身份 |
| [PROFILES.md](PROFILES.md) | 新设计的 SourceProfile/Target、完整库公开面、私有 CLI 入口、准确模型—方法—使用点绑定与失效规则 |
| [EQUIVALENCE.md](EQUIVALENCE.md) | 整个工程逐项保持、P→Q允许差额、消费者闭包、借用/效果证明及验证边界 |
| `models/P/`、`models/Q/` | 两版完整 Gift 路径算法；相同模块身份，只有 FileName 函数体发生语义修改 |
| `methods/P/`、`methods/Q/` | 对应的普通 Rust 借用切片实现；不是按项目名称命中输出的生成器 |
| `patches/P.patch`、`patches/Q.patch` | 原 Unix wrapper 接合与 private 模块声明；其余上游作者源保持 |
| [materialize.ps1](materialize.ps1) | 从精确上游修订创建全新完整实例；不解释 Gift AST、不生成 Rust、不安装工具或依赖 |
| [verification/path_policy.rs](verification/path_policy.rs) | 独立期望的22组字节用例；两版返回值与输入后缀指针检查 |

上游地址为 [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep)。固定版本：

- P：`4c2362d359d9913c7a5e391ccd79cb4da22bc89b`，tree `e41450e1cd2b5b7a3fef684b5c38cf5d504fc030`。
- Q：`7155f6408d370e699795dc75e954635abfaf08a6`，tree `4325a55a66d44bfa3bb25303bfcc30336cfd491d`；是P的直接子提交，修复尾点名称的hidden判定。

完整上游内容通过精确Git对象分发，不在维护仓库中重复提交两套第三方源码。本目录是版本化分发材料，项目模板的路径相对装配后的实例，不把同时包含P/Q两版材料的分发目录当成单一活动工程。装配后的实例实际包含所有224个上游跟踪成员及新增方法文件；并非只有远端引用、调用已安装rg的薄壳或源码摘要。上游许可证及原文件模式随Git对象保留；本例派生的两个方法沿用上游 MIT OR Unlicense。

CLI旗标、解析、命令模式、并行搜索和错误/退出本来就是产品决定。把这些 Rust 逐句镜像成JSON、再添加Args/Error/Effects回调表，会增加重复维护，不能证明精简。因此这些区域保持原生作者源；`defs.rs`也不被改名成“通用供给”而隐藏其产品责任。Gift模型用于明确算法语义，借用方法保留原生表示与成本责任。这一选择不证明纯Gift全工程迁移已经完成，也不证明该混合形式比原工程更小。

## 创建与继续编辑完整实例

在PowerShell中指定**尚不存在**的目录，其父目录须存在：

```powershell
& './examples/完整工程/ripgrep/materialize.ps1' `
  -Checkpoint P -Destination './.tmp/ripgrep-author-p'
& './examples/完整工程/ripgrep/materialize.ps1' `
  -Checkpoint Q -Destination './.tmp/ripgrep-author-q'
```

默认从官方Git仓库取得固定修订。已有准确本地仓库时，可用 `-SourceRepository '<本地仓库绝对路径>'` 复用对象；仍核对准确commit。脚本拒绝覆盖已有实例，失败时保留部分目录并明确报错，不删除未知工作。P/Q为两个独立检查点，没有运行时版本分派。

每份实例的结构是：

```text
gift.project.json
PROFILES.md
EQUIVALENCE.md
design/path-policy.module.json
native/                         完整独立的上游Git checkout
  Cargo.toml / Cargo.lock
  crates/ ...                   全部原生可编辑作者源
  crates/ignore/src/gift_path_policy.rs
  tests/ fuzz/ benchsuite/ pkg/ ...
```

实例内方法的唯一Rust写源是 `native/crates/ignore/src/gift_path_policy.rs`。分发目录的 `methods/P|Q`只用于创建新实例，之后不会自动覆盖实例修改。原 `pathutil` 的Unix wrapper已移除算法分支，只保留字节视图、调用和OsStr借用转换；非Unix分支不变。实例保留自身`.git`，防止 `build.rs`误读外层维护仓库的版本。

原生构建仍从实例的`native/`通过原Cargo入口执行；这只能构建已经提供的原生实现，不构成Gift模型被编译的证据。`gift.project.json`中的Target画像是设计请求，不能声称当前工具已有同名可执行Target。采用模型的准确边由[画像中的绑定设计](PROFILES.md#本例准确的模型方法使用点选择)给定，不能仅把JSON文件放进目录后宣称它已被消费。

Git对象还保存100755模式及 `HomebrewFormula → pkg/brew` 符号链接。Windows检出可能把后者保存为链接目标文本，且不能表达同一Unix执行位；这是保留源对象与宿主物化的区别。后续Unix/发行环境必须按原Git模式检出并核实链接目标与执行位。本次Windows实例不签发该平台物化或发行资格。

## 等价、第二次修改与体量

保持关系分别是 `Native(P) ≈ Mixed(P)` 和 `Native(Q) ≈ Mixed(Q)`。P→Q本来就改变尾点名称，不能让两个版本对全部输入输出相同。审查覆盖Types、Walk串并行，以及公开IncrementalIgnore直接hidden判定和父目录缓存对后代的影响；完整说明见[EQUIVALENCE.md](EQUIVALENCE.md)。

后续修改仍在真实作者源进行。模型变化会使原模型—方法保持资格失效；原生方法变化也需重新核对同一模型。项目不会因已有P/Q材料就自动处理任意第三次修改。真正的生产增量编译、受管回源与运行资格必须由未来实现取得。

固定P有224个Git跟踪成员，Git blob合计3,195,883 bytes；其中101个Rust文件、54,490物理行，Git blob合计1,845,231 bytes，tokei识别39,461行Rust代码。先前Windows CRLF检出的对应数字为3,263,542与1,899,721 bytes；差额来自换行物化，不能算成Gift精简。物理行、代码行和字节是不同指标。完整混合实例仍保留这些源码，还增加模型、方法、项目配置和审查材料；所以**本例没有证明源码大幅压缩，实际完整交付体量增加**。JSON去空白只影响序列化体积，不减少作者需要维护的语义，也不允许排除原生部分再比较。

已取得的证据分别记录原版P基准、源成员/接合核验、结构检查及方法向量；未执行的生产Gift链、四对象运行比较、Unix与多平台、其他features、性能和发行验证均明列于审查文件。任何局部PASS都不代称“整个工程运行等价已证明”。
