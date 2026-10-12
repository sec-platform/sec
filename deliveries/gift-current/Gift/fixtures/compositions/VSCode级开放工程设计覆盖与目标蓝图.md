# VS Code 级开放式软件：通用工程表达、目标蓝图与演进的组合压力用例

> **材料角色**：本文件是 Gift 通用系统语义的**组合覆盖样本**，不是 Gift Core 的新增业务模块、第二份可写规范、微软 VS Code 的源码复刻或已经生成的软件。以 2026-10-08 可见的 Microsoft 源码组织说明和公开 Extension Host 文档为参照。规范仍归对应 `docs/` owner；任何 `status: designed` 只指本样本的设计说明，不指真实 Gift 产品已实现。
>
> 官方参照：https://github.com/microsoft/vscode/wiki/Source-Code-Organization ；https://github.com/microsoft/vscode/blob/main/.github/instructions/source-code-organization.instructions.md ；https://code.visualstudio.com/api/advanced-topics/extension-host 。这些材料说明参考软件的源码分层、目标环境及扩展宿主，而不直接证明本样本具备同等功能。

## 1. 不固定行业词汇的完整对象映射

用户目标可以是“设计一个能在桌面、浏览器和远端工作区使用的专业代码编辑器，支持插件、语言服务、调试、终端、Git、扩展、配置、更新、无障碍，能够在独立工程中长期维护”。这只是一项高层目标，不意味着所有实现选择已经做出。以下业务对象均由**该用户作者工程定义**，不是 Gift 内建的 `Editor` 类：

| 作者领域对象 | 可观察职责和接口 | 状态与变化 | 与真实世界的作用/供给 | 在 Gift 中如何合法表达 |
|---|---|---|---|---|
| TextDocument / Model | 打开、定位、插入/替换、撤销/重做、版本快照、保存 | bufferVersion、dirty、历史、外部文件冲突 | 文件Provider、文本编码、可能的CRDT或Piece Tree库 | 值、类型、状态、转换、不变量、资源、接口、库 |
| Cursor / Selection | 多光标、选择变换、输入法合成、导航 | 范围、焦点、输入中、布局修订 | 输入设备、渲染事件 | 组件/状态/时序/端口；不能用文件名代替位置语义 |
| EditorView | 滚动、行换算、折叠、装饰、辅助提示 | 视口、布局、主题、可访问性焦点 | DOM/Canvas/桌面绘制Provider | UI事件、资源预算、状态与平台能力 |
| Workbench | 打开组/面板/布局、命令、状态持久化 | 窗口布局、活动视图、订阅与恢复 | 浏览器/Electron窗口和持久化 | 组合、事件、生命周期、端口与Profile |
| Configuration / Settings | 默认、范围覆盖、用户/工作区/机器设置、迁移 | 配置修订、来源、冲突 | 存储、秘钥/政策、Settings Provider | 控制/有效值投影、版本、状态，不造全局`settings`真源 |
| Commands / Contributions | 注册、枚举、调用、卸载、冲突裁决 | 注册表、优先级、来源与失效 | 插件宿主的实际注册回执 | typed registry、版本、权限、动态能力；不是编译期静态枚举 |
| Extension Host | 按扩展API执行、隔离、激活、卸载/重启 | dormant/activating/active/failed/disposing | local Node、web host、remote Node 的合格Target/Provider | 单独运行主体、IPC/Port、生命周期、作用和信任边界 |
| Extension Package | manifest、依赖、激活事件、API版本与资源 | 已安装、禁用、更新中、失效 | 来源仓库、安装/签名、许可与供应链 | 作者/外部资源、包锁、ABI和发布演进 |
| Language Service | 语法/语义诊断、补全、重命名、索引、跳转 | 文档版本、任务、缓存、取消 | LSP/语言服务器/编译器工具 | 协议、异步请求、校验范围、晚到值拒旧 |
| Debug Session | launch/attach、断点、栈帧、变量、继续/终止 | disconnected/launching/running/paused/terminated | DAP、debug adapter、目标进程 | 状态机、远端资源、身份及不可逆Effect |
| Terminal | PTY数据、输入/输出、调整、信号、关闭 | 进程和订阅者寿命、缓冲、退出状态 | OS shell/PTY/安全策略 | 进程端口、字节流、背压、权限、信任 |
| Workspace / File | 文件树、URI、搜索、监视、保存、冲突 | 多根、文件版本、dirty、离线/只读 | local/remote FS、同步、大小写/链接/权限差异 | 多源快照、外部观察、路径与身份分离 |
| SCM / Git | stage/diff/commit/branch/status、冲突视图 | 工作树/index/ref/remote revision | 本地Git与远端平台 | 效果作用与实际读回；文件差异不是git状态 |
| Search / Index | 文件/符号搜索、过滤、可取消、局部结果 | 索引generation、覆盖、时效 | FTS、LSP、native search、远端Provider | 查询范围、分页/背压、完整性/权限 |
| Remote Agent / Server | 远端认证、文件、任务、扩展、调试与转发 | 会话、断连、重连、恢复，版本协商 | SSH/WSL/container/cloud/网络；具体可选 | 节点主体、协议、租约、环境假设、恢复义务 |
| Accounts / Trust | 用户身份、工作区信任、访问密钥、数据披露 | Grant、revocation、policy revision | OS identity、auth provider、秘密管理 | 公共principal/capability/披露，不用role名称代签 |
| Tests / Build / Packaging | 目标工程的静态/集成/发行义务 | build graph、产物代际、测试环境/证据 | TS工具链、Electron/Web/Server打包和签名 | 目标构建/发行图、证据Claim；设计中不执行 |
| Update / Compatibility | 配置/数据/插件/协议升级与回退 | 旧/新实例共存、迁移窗口和消费者版本 | package/update/download provider | 兼容、数据迁移、发布、撤回和责任结算 |
| Themes / Localization / Accessibility | 主题、语言包、屏幕阅读器、键盘操作和高对比 | 配置/资产/布局/可访问性状态 | 浏览器/OS可访问性API、翻译/资源 | 行为要求、资源、接口与可观察验收 |
| Telemetry / Privacy | 诊断、选择性上报、脱敏与生命周期 | 披露同意、留存、事件聚合 | 数据服务、日志存储、隐私政策 | Requirement、Effect/Disclosure、Observation/Claim |

每行都可能由现有代码、第三方库、作者算法或明确Need提供；不是 Gift 保证提供了现成实现。若用户没有选择遥测/Marketplace/远程功能，就不应为凑表自动让其发生网络效果。若选择了某一对外功能，所有与其可观察行为相关的状态/错误/资源与支持平台必须闭合，不能因当前缺Provider删除它。

## 2. 三套架构和四套身份

**源码图**：`src/vs/base`、`platform`、`editor`、`workbench`、`code`、`server`和`extensions`是参考的目标源码区域，语义可以映射到不同物理组织。`common/browser/node/electron-*/remote` 是平台资格约束，不是同一个函数在所有端都使用Node API的许可证。Microsoft当前源码指南还出现了`sessions`层；本用例不得因旧版示意不含它就证明实际VS Code没有该部分。

**运行图**：一个桌面UI/主进程可以与 ExtensionHost、语言服务器、Terminal/PTY及远端 Agent 分属不同进程或机器。`Editor`模型和`Workbench`视图可能在一个renderer中，但独立的扩展执行主体与其故障责任不能用源码import合并。Browser-only不能假设存在本地Node shell；remote启用后要决定实际File Provider和extension host部署位置。

**构建/发行图**：共享基础/浏览器bundle/桌面主程序/remote server/内置extension包分别有工具链、资源、依赖、构建先后、许可及发行控制。构建某个源码包成功不等于当前桌面进程或浏览器缓存已加载新bundle；签名/下载成功也不等于用户已采用新版本。

**身份边界**：(i)作者定义与修订，(ii)目标代码模块与目标成员，(iii)运行进程/实例与session，(iv)外部用户/Grant和Evidence对象。名字一致不意味对象相同。旧Editor进程中的文本缓冲版本、用户Git工作树head与Gift作者候选revision可以同时不同；设计需要正确映射而非统一成全局`version`。

## 3. 人类开发者会看到的目标工程结构

```text
ide-author/                                   真正作者范围：用户决定与源
├─ gift.project.json                         持久Gift项目时才建立
├─ design/
│  ├─ product.module.json                    产品要求、公开根与支持环境
│  ├─ editor.module.json                     用户独有的文本模型要求/算法
│  ├─ workbench.module.json                  UI责任及对外交互
│  ├─ extension.module.json                  动态注册和宿主协议
│  └─ remote.module.json                     远端效果/权限/恢复
├─ native/                                   允许保留的用户/第三方真实源
├─ resources/                                作者拥有的资产和许可说明
└─ gift.lock.json                            解释/实现/target被实际采用后才存在

[派生、只读] TargetProjectPlan            按特定Target/Binding查询；不作源文件
└─ ide-target/                               计划中的专业目标工程
   ├─ package.json / target lock / config    构建生态输入及真实依赖
   ├─ build/                                 桌面/Web/Server输出图
   ├─ resources/                             图标、主题、语言包和发行资产
   ├─ src/vs/base/                          基础类型、事件、生命周期
   ├─ src/vs/platform/                      服务与共享接口
   ├─ src/vs/editor/                        文本编辑核心
   ├─ src/vs/workbench/                     工作台、贡献和配置
   ├─ src/vs/code/                          桌面宿主与入口
   ├─ src/vs/server/                        远端服务
   ├─ extensions/                           可用扩展及其包/契约
   └─ tests + release plans                 未来实际工程验收和发行责任
```

这些只是可审阅的**设计树**。未指定实现的 `editor.module.json` 不会凭字段名产生完整撤销算法；未绑定的 remote provider 不会自动启动远端server；软件的具体UI、资源、菜单、快捷键、扩展API也不靠文件存在来闭合。用户真实Goal可以选择与 VS Code 不同的布局；目录和图是有确定输入的结果，不是Gift把行业模板当语义真源。

## 4. 各种运行环境的差异要在设计里明确

| 环境/目标 | 有资格使用的能力 | 不能无条件认为存在 | 设计上的必要区别 |
|---|---|---|---|
| Desktop Electron | 浏览器工作台与有权限的desktop/Node适配 | Web沙箱同权，本地扩展等同远端扩展 | 主/渲染进程分界、配置与secret、native协议、更新回退 |
| 浏览器纯Web | DOM/Web Worker/浏览器存储/标准网络能力 | 任意OS文件、PTY/本地shell、Node原生模块 | Web extension host、FileSystem可用性、离线/配额、CSP与披露 |
| 远端工作区 | 远端文件/搜索/语言/terminal可由真正远端服务提供 | 本地绝对路径==远端路径，跨网络无延迟 | remote identity、RPC、重连、流控、权限/秘密分隔 |
| Web+remote host | 浏览器UI与远端Node工作区侧扩展可分离 | 所有扩展都可在web或remote互换 | extension host kind、API支持和位置协商 |
| 多根、多租户 | 各root与身份域独立持权，可在同窗口显示 | window拥有所有root的共同作者写权 | scope过滤、缓存披露、相交事务/冲突 |
| 离线/断线 | 允许按当前缓存契约读取已取得资料 | 当前远端提交成功/失败已知 | 过期依据、待续状态、部分可用与unknown效果 |

参考 VS Code 官方 Extension Host 文档，desktop、web和remote具有不同宿主运行位置；它并不承诺Gift自带远端Provider或已做过真实兼容测试。

## 5. 关键状态与正常/异常轨迹

### 5.1 文本编辑与保存

`ModelReady(v1, content1)` → 接收键盘/插件文本Edit → 按原算法产生 `ModelReady(v2, content2)` 与历史 → 文件保存前比较本地文档版本和远端/磁盘前像 → 写入由实际文件Provider结算 → 更新文件观察与dirty状态。若输入法组合未结束、插件提供过期范围、磁盘被外部作者改写，不能用同样路径覆盖；保存失败保留未保存buffer。撤销应回到作者选择的历史语义，不一定回到文件系统旧字节。目标语言的字符串索引单位与编辑器的文本位置模型不同，需要显式转换。

### 5.2 插件动态激活与崩溃

`installed-disabled`、`installed-dormant`、`activating`、`active`、`failed`、`disposing`表示不同的用户领域状态；动态注册的命令只有宿主确认版本和生命周期后可调用。插件崩溃后的合法结果可以是禁用特定贡献、标记失效并重启，不能让整个Workbench已打开文档无理由丢失，也不能因插件已安装就报告已经激活。配置更新与进程关闭可以并发，资源/消息与重启责任按明确owner结算。

### 5.3 语言服务晚到结果

缓冲由`v8`改到`v9`，LSP请求`r1(v8)`之后返回诊断或Edit。接收者必须区分只做历史解释与真正应用到`v9`。若不存在正确的转换/重基证明，不能直接按老range修改当前文档，尽管LSP server和消息语法都完全正确。取消`r1`不证明server已停止或响应永远不会到达。

### 5.4 ExtensionHost远端迁移

第一版 `ExtHostLocal@MachineA`，新候选要求 `ExtHostRemote@WorkspaceB`：公开extension接口尽可能保持兼容；用户明确允许的远端功能由新RPC传输/认证/路径/秘密/权限/断连/序列化/延迟/监控/部署支持。变更会影响远端worker生命周期、诊断位置、扩展安装、适配器和程序调试定位；不会因为搬远端就要求文本核心的所有数据结构都重写。如果原插件使用只能在local Node运行的 API，要明确阻断或给出替代，而不是在Remote版本运行时报错才承认设计缺项。

### 5.5 重启、跨版迁移与恢复

已有用户settings、新版本schema、插件存储和Workspace都可能拥有不同迁移程序。设计必须确定：旧读者何时还能读、新写者何时能写、迁移是否幂等、部分转换后的回滚/补偿、老实例与新实例共存、用户数据备份以及不可逆点。没有被证实的安全回退路径时必须显示相应设计Need；旧构建产物可启动不意味着旧数据格式仍可逆读。自动更新只属于未来授权的发布Operation，蓝图不执行下载。

### 5.6 高负荷与失效

打开超大文件、百万符号索引、数百扩展、高频文件监视与远端长延迟是不同资源瓶颈：UI帧预算、Worker内存/背压、进程IPC、网络、磁盘吞吐和启动步骤分别有真实限制。设计可以选择增量分析、惰性加载、可取消查询和容量预算；性能数值必须依据目标环境与证据确定，不为了表示“极致”随意写一个毫秒上限。无限循环扩展不能靠“计算模型允许不终止”推导主界面仍响应；要有实际监督/隔离机制与供给。

## 6. 专业目标工程的交付准备清单（设计，不是运行测试）

一个明确要求具备这些能力的 IDE，目标蓝图至少要按以下**相交要素**逐项建立有权的决定、实际供给或明确Need：

1. 用户可观察功能的完整列表、输入/输出和负场景；
2. 文本模型的数据结构、编辑/撤销/持久状态和并发语义；
3. 公开extension API、注册/调用/生命周期、平台差异与版本政策；
4. UI菜单/快捷键/主题/自定义视图与无障碍；
5. 搜索、索引、文件监视与大数据量退化；
6. LSP/诊断/代码动作/重命名的版本与取消；
7. DAP/调试资源/断点状态与结果归属；
8. Terminal/PTY、任务/进程、权限与退出清理；
9. Git和远端仓库与多根/未保存工作区的实际关联；
10. File URI/大小写/编码/符号链接/权限/文件修改竞态；
11. 扩展宿主local/web/remote选择、故障隔离与更新；
12. 环境、网络、隐私/秘密、trust与数据披露；
13. 具体目标依赖、实现供给、运行库、许可和资产；
14. source/modules、build graph、package、signature、update、release与部署拓扑；
15. 配置/数据/公开API迁移、回退、退役、历史兼容；
16. 功能、资源、性能、安全、可靠性、可访问性方面的准确未来验收Claim。

这些不是十六份必建文件。普通用户从必要设计开始，按需渐进下钻；不相关能力可证明不适用，未决定的已请求能力不能改成`N/A`。

## 7. 哪些信息无法由通用核心自动取得

即使所有软件都能用通用计算机制编码，本用例仍需作者或供给给出：文本编辑算法、插件规范兼容目标、每个发行环境的硬边界、UI风格与可访问性政策、密钥/许可证和外部服务选择、性能预算及其取证条件、用户数据迁移/回退策略、运行时动态插件的真实安全能力。它们不能从“要像 VS Code 一样专业”唯一推导。

**未决与反转条件**：如果用户要求100%复刻某一准确VS Code版本的全部内部行为、扩展兼容、构建和发行字节，就必须选定版本、完整代码/许可与可观察全集，并在真正生成和运行后取证；本文件并未为此取得必要输入。如果用户只要求设计一种可扩展IDE，则可选择合法的不同算法和架构，只要明确范围内的用户可观察义务和工程质量合同成立。两种任务不可用同一“完全等价”标签合并。

## 8. 同源图形与无GUI开发的对应

用户在Gift侧边栏选中 `ExtensionHost`，看到接口、状态和信任边界；点击“修改运行位置”产生有准确base的候选；检查 Impact 后只在原有真实owner保存有权采纳的变化。CLI/AI端可使用同一候选语义和来源查询，不要求有GUI或已实现扩展。**基础 `gift.ai-tools/2` 没有 `view=blueprint` 或 `preview(return=plan)`**；工程蓝图应经现有 contract/origin/impact 的有资格派生方法读取，未实现则显示Unsupported，不改造公开schema偷偷实现。用户要求“只完成设计”时不运行`tsc`、不生成目标App、不开远程进程，也不能凭设计检查报告出绿色产品验收。

## 9. 用于覆盖而不是按行业倒推语法

此样本能暴露组合障碍，如同一用户的跨进程身份分裂、插件动态注册导致的旧依赖负项失效、host迁移改变原资源寿命、单一工作区被不同authority读写、无源码改动却更换目标布局造成兼容回退等。一旦能被已有通用机制表达，必须保留在**作者定义/可选方法/目标适配**层，不因为VS Code有这套机制就修改Core。只有发现一组现有组合无法区分的真实相反可观察结果、并经绕行反证，才重开Core语义。一个独立行业实例即使很复杂，也不能逻辑证明“所有未知未来专业工程都已经覆盖”。
