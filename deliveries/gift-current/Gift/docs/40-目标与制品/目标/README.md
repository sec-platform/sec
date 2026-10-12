# 目标成员、降低与回源

先确定产物必须包含什么，再看具体目标降低和连续生成；生成代码的存在不改变作者写权。

[返回上层](../../30-实现解析/README.md#gift-unit-compiler-overview)

## 建议从这里进入

[目标责任与决定输入](成员布局-目标责任与输入.md) → [布局、成员与完整装配](成员布局-完整装配与布局.md) → [变化、回源与保证](成员布局-变化回源与保证.md)。具体语言降低见[目标输出](具体降低与目标输出.md)、[Rust目标画像](Rust目标画像与降低.md)；稳定编辑与持续写回见[结构稳定与作者回源](结构稳定与作者回源.md)。

[交付消费合同与发射](交付消费合同与发射.md)逐类约束方法的输入、实际接口、完整成员与接受边界；使用原编译链，不按形态名字创建新服务。
<a id="open-target-profile"></a>
## TargetProfile 是开放目标合同，不是内置目标枚举

Gift 不维护 `TargetKind = Web | Service | CLI | GPU | Firmware | ...` 这样的中央产品/平台枚举。目标是**作者含义已固定之后的一组目标解释、降低、工具链与交付约束**；用户、组织或第三方可以提供新的 TargetProfile，只要它仍接回同一身份、Binding、Artifact、Execution 与 Assurance 主链。新增语言、ABI、设备、运行宿主或封装方式不要求 Core 先认识其品牌或行业名称。

一个 TargetProfile revision 至少能够解析下列实际责任；这是概念合同，不要求把它们复制进一个万能 JSON：

| 责任 | 必须固定的事实 | 不能偷做的事 |
|---|---|---|
| identity / provenance | 稳定 target identity、精确 revision/content、来源与采用关系 | 用显示名、文件扩展名或“本机已安装”冒充身份 |
| semantic boundary | 它接受哪些已绑定语义/接口，哪些区别需要专有扩展，哪些明确不支持 | 由 backend 重新解释作者 Meaning 或把未知语义猜成目标默认 |
| platform / ABI / representation | machine/runtime/platform、调用约定、数值/内存/布局/编码/模块规则及适用范围 | 只写一个 triple/语言名就宣称 ABI 与运行行为闭合 |
| lowering capabilities | 可用 lowering/mapping 的身份、revision、前提、保持条件与 residual obligation | 按 target 名字进入中央 `switch` 后静默选择未绑定规则 |
| toolchain / provider | compiler/linker/bundler/SDK/driver/runtime 等真实供给、版本、许可、资源与执行条件 | Profile 自己给 Provider 签发资格或安装脚本执行权 |
| artifact contribution | 目标成员、入口、资源、元数据、装载/发行关系及完整性规则 | 把目录存在、源码生成或单文件成功当完整 Artifact |
| runtime host / effects | 运行需要的宿主能力、Grant、资源、启动/停止/恢复与外部作用边界 | 因选择 Target 自动取得文件、网络、设备或部署权限 |
| compatibility / migration | 与旧 revision 的读写、ABI、Artifact、运行实例共存与迁移/退役条件 | 用版本号大小或 `latest` 热改旧任务解释 |
| assurance hooks | 本目标新增或改变的可观察义务、允许的方法/Oracle前提与 Evidence 适用条件 | 以“Profile 已注册/构建过一次”签发跨环境支持声明 |

**发现不等于采用。** Registry/包索引可以发现 TargetProfile 候选，但一次编译只消费已按当前作者语义、Requirement、目标用途、Provider 资格与权限解析并冻结的 target revision。注册顺序、安装时间和全局默认不能在冻结后改变同一 ArtifactRef。新目标出现时，旧任务只有在自己的解析策略真实观察候选集合时才需要重新解析；不相交工程不失效。

**采用不等于实现。** Profile 可以完整描述目标而尚无合格 lowering/toolchain/Provider，此时作者 Meaning 仍可保存，目标结果返回准确 Needs/Unsupported。后端只消费已绑定语义和选择，不拥有第二套 overload、Requirement、权限或 Evidence 规则。一个第三方 Target 需要过程扩展时，其代码按普通扩展执行边界隔离；数据可读、规则可解释、代码可执行是三项不同资格。

**升级与退出。** 新旧 TargetProfile revision 可以在不同根/运行实例中并存；迁移只影响真实消费者。停止新绑定、保留旧解释/工具闭包、迁移仍活跃的 Artifact/运行责任、消费者归零后退役，不能因为新 Profile 安装成功就重解释旧字节。目标的公共兼容性由实际语义、ABI、Artifact 和宿主条件判断，而不是版本字符串。

因此开放目标接入的验收不是“预装了多少后端”，而是：一个此前未知的合格 Target 能否在**不修改业务 Definition、不建立第二权限/证据系统、不修改中央 target 枚举**的前提下，通过自己的 Profile + lowering/Provider 供给形成准确 Binding 与 Artifact；失败时能否只暴露真实缺口。具体成员闭合见[交付消费合同与发射](交付消费合同与发射.md)，目标能力差额见[能力履行与接口差额](能力履行与接口差额.md)。

<a id="gift95-cross-contract-14"></a>
## 目标供应清单的有限机器协议与不可替代条件

现有开放TargetProfile仍不增加中央TargetKind枚举。为使供应者与Resolver对接，有限 `gift.target-profile-manifest/1` **设计载体**按 `profile/publisher/accepts/representation/loweringRefs/toolchainRequirements/members/host/compatibility/evidenceObligations` 区分责任；机器草案在 `fixtures/contract-closure/Gift95/schemas/target-profile.proposal.schema.json`，不能独立签发Target已发布。

`representation`在本Profile中明确语言、文本索引单位、整数语义、异常模式与模块形式；`loweringRefs`必须指向真实可解析并可准入的Provider/方法；`members`声明源码、manifest、tsconfig、资产及辅助运行库等交付必需角色。工程布局不是仅列文件名：成员依赖、路径合法性、冲突、生成者和可用性按原目标装配合同另核。`toolchainRequirements`是待取得供给，不会因为在JSON写入编译器名字就安装它。

拿不到目标Content、合格lowering、实际工具链或行为保持证据时，可保存请求与返回目标Need，不能用宿主默认目标补全。旧Profile仍可被合法既有Binding继续消费；换Profile或ABI需重新评价受影响Artifact/运行/Evidence。
