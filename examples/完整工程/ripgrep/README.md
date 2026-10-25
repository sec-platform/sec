# ripgrep：全工程 Gift 作者源码迁移（进行中）

本任务终点是 **ripgrep整个工程的Gift开发面作者源码**：CLI、九个库中的原项目逻辑必须逐层取得真实Gift定义、算法、状态/资源责任和消费者接合；仅保留有具体理由的原生边界。旧混合原型只迁移Unix路径函数，不能算达成这个终点，上一轮整体完成结论撤回。完整原生快照仍是对照证据，不能替代尚未完成的作者源码。

当前`author/`逐层形成新的作者源码与每片SOURCE说明，未闭合的跨模块引用、目标接合或公开面保持明确开放。不能把它们称为已完成工程。`models/`、`methods/`、`patches/`及`materialize.ps1`仍保存已经核验的单算法混合原型；其十个native根模板不是最终Gift工程的完成证据。生产Reader与Rust生成链仍未执行，设计和运行验证分别保留义务。

全量范围按原工程责任推进：CLI参数/配置/命令及搜索组织；globset解析/优化/匹配；ignore规则/类型/增量缓存/串并行遍历；Matcher与Captures；regex/PCRE2引擎接合；searcher读取/行缓冲/搜索/sink；printer文本/JSON/颜色/超链接/统计；cli进程/解压/终端；grep公开转导；构建、维护、测试和发行入口。外部regex/PCRE2实现、OS、线程/原子/IO、分配与目标ABI可以有具体原生实现边界，但原项目的控制算法、规则和格式决定不能整块藏到这些名字下面。

## 作者层的当前前沿

以下是真实源文件的阶段状态，不是完成率；“已落源”不代签完整类型、链接、目标或全域等价。

| 原工程责任 | 已落源的部分 | 仍须闭合的部分 |
| --- | --- | --- |
| globset | `author/globset/`的完整Unicode标量解析、regex渲染、literal/extension/prefix/suffix/basename策略提取；`author/foundation/fnv.gift`的FNV纯算法 | 真实Text/路径输入、候选和集合匹配、公开API、serde、外部regex及Hasher/HashMap接合 |
| ignore | `author/ignore-types/`的完整默认类型数据、定义/选择/构建步骤与分类算法 | 共享文本方法与glob实际消费；gitignore/override/dir规则、incremental缓存、串并行walk及平台条件 |
| matcher | `author/matcher/`的值层算法、Captures默认算法与完整replacement插值扫描 | 实际Captures/Matcher trait声明及实例、全部Matcher默认搜索方法、开放下游、机器值/借用/格式化实际接合 |
| shared text | `author/foundation/text/`的标量UTF-8编码、ASCII与两位小写hex转换 | 真实Borrow/Str视图、Unicode分类/trim、错误格式化与所需其他共享声明 |
| core flags | `author/flags/lowargs.module.json`的完整低层类型、默认值与方法 | 104个Flag更新及顺序、parse/config、HiArgs转换、flags门面、help/man/completion以及实际消费者 |
| core command | `author/command/`的Main/Run与信息出口、Types输出组织 | sessions搜索/列举实现、messages/errors、完整信息生成、资源/输出和真实依赖接合 |
| regex/pcre2 | 暂无完成的作者子层 | 保留外部引擎，但自有配置、pattern/AST/HIR转换、字面量优化、错误与Matcher实现都必须迁入Gift |
| cli | `author/cli-text/`的escape/pattern转换、错误政策与逐行读取算法 | 任意Read/AsRef实例与效果、实际IO/借用接合、子进程/解压/hostname/终端和其余公开接口 |
| searcher/printer | 暂无完成的作者子层 | 搜索/缓冲/sink状态机、全部输出格式和策略、资源/并发协议与公开接口 |
| 完整工程 | 源对照、入口/DAG及资产范围已清点 | Gift产品根与公开转导、build.rs逻辑、生成配置、测试/harness、fuzz、benchmark runner及发行脚本中的自有算法；原数据/模板/许可按准确资产继续保全 |

当前最上游的共享设计义务是机器数值与生命周期原语、真实trait声明/实例及最终Gift SourceProfile。`opaque type`以及[开放trait/关联类型/默认分派的结构接合](../../../docs/领域/计算基础/作者表示与实现分工.md#structured-trait-profile)已回到原共同合同修正；新结构不代替ripgrep实际声明、实例或生产类型器。各片`SOURCE.md`逐项列出真实import签名和未完成边界；尚未实现的ripgrep自有模块属于待迁移，不会被更名为“必须原生”。最终接合必须消费同一组定义和身份，而不是让每片各建一套回调或类型表。

完整交付验收要同时确认：全部自有算法有作者主体；保留原生逐项有原因；实际公开接口/实例/错误/资源保持；唯一作者源与第二次修改闭包；全工程根和构建输入可解释；独立审查覆盖真实消费者。生产执行未验证可按用户范围明列，但缺作者主体、缺接口设计或缺消费者不能借此免责。

## 已核验的局部混合原型（不作为总目标完成）

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

CLI旗标、解析、命令模式、并行搜索和错误/退出本来就是产品决定。在这个历史混合原型中，它们保持原生作者源；这项范围不足正是继续全工程迁移的原因。当前迁移把真实算法写入Gift并沿共同类型/资源合同接合，不再添加Args/Error/Effects回调表来隐藏整段产品行为。`defs.rs`也不能被改名成“通用供给”逃避迁移。旧混合形式不证明全工程Gift完成，也不证明比原工程更小。

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
