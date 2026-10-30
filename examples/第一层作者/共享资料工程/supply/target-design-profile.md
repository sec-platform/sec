# 共享资料库的 TypeScript 目标设计合同

本文件是`profile:shared-views-typescript-library`的修订`1`的完整设计内容，由`example:shared-views`工程持有。工程清单的`profileRef:{"id":"profile:shared-views-typescript-library","revision":"1"}`请求本内容，后续锁固定本文件及相交定义的准确字节/修订，不能只按名称追逐latest。

这是已有[开放TargetProfile](../../../../docs/编译/目标/能力履行与接口差额.md#open-target-profile)的声明设计，不是`gift.target-profile-manifest/1`的实例，不宣称已安装目标、Method、Reader或工具链。它固定作者要求的输出和保持合同；实际生成另取得真实实现、lowering、工具链、资格及所求证据。下文没有实现body，产品含义、公开接口和失败责任仍已完整。

## 身份、源根与产品参数

准确消费`module:shared-views`的公开组件`Workspace`，所选根为目标`ts`内的`rootId:package`。Profile明确接受该组件根：一次公共`create`调用对应一次Workspace构造尝试，成功发布一个新的工作区句柄，失败不发布工作区。公开组件并非普通CallableIndex函数；不得把组件定义直接compute-eval。

`Workspace`的`api`端口所提供的六项操作分别映射为句柄的`replace/readMain/readPreview/setMainThreshold/setPreviewThreshold/close`。`create`是本目标的构造门面，不是另一个必须由应用维护的Gift算法定义。不得把类型名或声明文件误认为它已有运行实现。其公开Gift采用出口仍为Workspace；目标包根只公开一个具名值`create`，无默认导出，不额外公开Store、ThresholdView、TwinViews或内部政策。

目标参数是恰含`packageName`与`packageVersion`的对象。`packageName`在本工程为`shared-views`；`packageVersion`是本次接受的明确包版本，首次为`0.1.0`，实际发行时须符合所选包工具的版本合同。参数改变形成真实源修订，不能被输出生成器私自覆盖。A/B造成公共行为变化时显式选择新版本；C/D/reset若保持全部承诺不自动制造版本变更。目标参数不拥有初始阈值、筛选政策或容量上限，这些由原应用定义拥有。

`module:shared-views-policy`的Row/Rows、DecodeRows、RowsEqual、KeepByThreshold、CapacityValid及其依赖是实际政策源；普通序列含义来自原`module:gift-sequence-values-v1`。本文件只映射目标边界和要求，不复制这些函数/关系body，也不发明名为过滤的目标原语。组件结构、操作观察及正常/错误关系来自Workspace的准确模块导入和定义，不从Profile名称推导。

## 公共类型与名称

以下为所要求的声明形状，类型名可私有或内联；唯一包根值出口为create，声明可达性不能擅自增加运行值出口：

```typescript
interface Row { score: number; text: string }
type Ok<T> = { ok: true; value: T };
type Failed<E extends string> = { ok: false; error: E };
interface WorkspaceHandle {
  replace(rows: readonly Row[]): Ok<null> | Failed<"InvalidInput" | "CapacityExceeded" | "Closed">;
  readMain(): Ok<Row[]> | Failed<"Closed">;
  readPreview(): Ok<Row[]> | Failed<"Closed">;
  setMainThreshold(value: number): Ok<null> | Failed<"InvalidInput" | "Closed">;
  setPreviewThreshold(value: number): Ok<null> | Failed<"InvalidInput" | "Closed">;
  close(): Ok<null>;
}
export declare function create(initialRows: readonly Row[]):
  Ok<WorkspaceHandle> | Failed<"InvalidInput" | "CapacityExceeded">;
```

这是目标声明合同，不是可以被选择为已有运行方法的原生供给。静态签名中的number/string/readonly不会扩大实际值域或消除运行检查。方法适用于成功create取得的真实句柄；伪造receiver、访问/修改私有存储和未声明反射行为不属于接口。

输入条目是仅含score/text的被动数据记录，数组连续且没有额外成员；准确own键、孔洞、额外string/symbol/非枚举字段、继承字段与非法标量的处理沿原DecodeRows及被动值声明Profile。评分及阈值必须是0..9整数；number不把NaN/Infinity/小数/字符串/bigint纳入评分。Text为Unicode标量序列，目标string必须合法编码，孤立代理项拒绝，配对代理项计一个标量；不正规化、不按字素或UTF-16码元计容量。Proxy、accessor、可执行对象及具有任意用户代码读取作用的对象不在被动输入承诺域内，不承诺安全识别任意JS对象。

Unit映为null；正常业务错误映为上述discriminated union，不能改成throw或用成功空值吞掉失败。每个入口只出现其列出的错误分支。调用者通过自身逃逸类型传入承诺域内但结构无效的被动值时仍按运行输入合同检查；TS类型检查不能代签运行值合法。

## 行为、错误、状态和正常进展

库同步、单调用线程使用；同一工作区调用不重叠、不重入。不启用后台工作、异步队列、定时器或跨线程共享状态。正常域内，在所需宿主执行及分配资源可用且无宿主终止的前提下，每次有限输入调用在其同步边界完成；不能以永远返回未知/不可用或无限等待满足合同。没有墙钟时限或物理内存上界保证。

构造的输入无效与容量超限按准确互斥关系分类；合法且容量合格时成功创建一份资料仓和两个独立阈值视图；不同工作区各自独立，不因定义或参数相同合并可变状态。初值取源中各采用处参数，初版为5/5，A之后按真实后继源解释，不在Profile中重复固定。

开放时五个转发入口各委托对应真实成员一次，保留参数、结果和失败；replace的InvalidInput或CapacityExceeded也恰委托Store.replace一次，不把Workspace提前拒绝冒充同一调用历史。读取在本次调用取得同一来源的稳定只读快照并用本视图本次阈值筛选，保序、保重，不改变资料/阈值；替换原子地成为新资料值，不重置阈值；设阈值只改对应视图。首次关闭由Workspace自身完成持有关系结算一次并转Closed，不委托虚构的成员close；重复关闭成功且不重复结算。Closed时其他五个入口首先返回Closed，不读成员、不检查raw、不dispatch。

开放时InvalidInput优先于CapacityExceeded，必须完整验证输入，不能用前缀容量超限掩盖后项非法。业务输入/容量错误保持所有状态，成功时的精确帧沿原操作合同。外部修改输入或返回数组不影响仓内资料；读回是调用者拥有的值，不是可变仓内别名。工作区关闭后已返回值仍有效；解除持有不承诺垃圾收集立即回收物理内存。

容量沿CapacityValid按条目出现数≤10000、各文本Unicode标量数和≤100000解释，重复项分别计数；空资料合法。Math Int的计量及比较必须精确，不能让binary64整数舍入改变关系。实现可采用合格的精确表示或有证明的有界算法，但不得静默饱和、溢出、前缀接受或改变错误优先。

宿主终止、分配失败及本Profile未承诺的外部故障不保证能正常返回业务结果，不得将其伪装成InvalidInput/CapacityExceeded/Closed。目标仍需说明真实实现的该故障边界；“不承诺宿主存活”不允许正常域内留空实现。

## 完整产物、依赖与无外部效果

目标为TypeScript源码库工程，运行形态为ECMAScript模块。包根运行入口`dist/index.js`，类型入口`dist/index.d.ts`；包根仅具名导出create。源码至少有`src/index.ts`及为实现真实需要的私有源文件；生成的声明、实际JS成员、包清单、构建配置、准确工具依赖及其原生锁、构建命令和使用说明共同构成实际交付责任。这里的路径是要求，不表示文件已生成。

目标唯一组合器汇合文件、依赖、类型、初始化和来源贡献，核路径、依赖冲突、真实成员归属及公开接口，不由各方法独立覆盖package.json/tsconfig/锁。实际锁由所选成熟包工具拥有；Gift消费准确结果，不另算一套依赖解析。具体TypeScript/compiler/builder版本与完整命令在真实生成/构建准备时固定到准确供给和内容，不能把本设计字符串当作已安装版本或任意选择latest。

公开运行库没有网络、文件系统、环境变量读取或其他外部服务进口；状态、临时分配和清理仅在所声明的工作区/调用范围。私有源不得引入这些能力，构造/读/替换/设阈值/关闭不能暗用外部IO或执行用户回调。生成和构建工具的文件作用与其当次权限另按真实执行准入，不由选择目标自动取得。

最终目标候选须给实际完整源码、包/配置、工具锁、可重建入口及必要说明。若尚缺内部实现、lowering、类型/效果/接口保持或必要成员，保留准确Needs，不交付空方法、TODO、虚构Provider、仅声明包或空ArtifactSet并称完整工程。现在只完成作者设计出口，这些义务保存但不要求本轮执行。

## 定义位置控制与后继

支持的设计语义沿原`generation.definition-file`修订1：准确源定义`module:shared-views-policy/KeepByThreshold`，目标ts，根package。D的require把实际产生筛选结果的私有callable anchor放到`src/filter.ts`，不导出包根filter、不改变政策、状态和公共入口。映射须沿源Definition→合格输入/阈值到输出的构造实现→真实LoweringResult producing declaration→源码成员，不能把Bool校验器、同名helper或假wrapper当输出实现。

同一root多个特化必须有已合格共同anchor，或准确报告多重性缺项/不支持；多个root若共享状态不能按路径要求盲目复制。内联实现的anchor物化、文件拆分、内部ESM export/import仍联合核捕获、调用次数、错误、效果、资源、构建及声明成员闭包。内部链接导出不扩大包根API。路径冲突、私有性冲突、无构造方向或后端不消费分别报告原Need/Conflict/Unsupported，不把require降成prefer。

reset只删除本ControlFile原逻辑键，本链保留同fileId的空records；重新解释其他控制和布局基础，没有剩余强制时允许仍在src/filter.ts，不承诺搬回旧路径。A/B/C的已接受源变化不被reset撤销。C保留原状态/发生身份与拥有关系，准确映射按原编辑对应；Profile不因新边界创建额外状态或调用。

## 保持证据、共存及采用边界

设计核对涵盖空/非法输入、孔洞和额外键、数值与Unicode边界、容量恰上限/超一、前缀超容量后项非法、重复项、值别名隔离、共享资料/独立阈值、Closed优先、重复关闭和返回值寿命；连续A→B→C→D→reset保留其准确前后、身份对应及实际消费者。任意有限合法调用历史的C保持须满足原调用、观察与拥有前提，不由几组输出或TS类型检查签发。

未来实际生成请求须取得真实Method/lowering、表示/类型/效果/接口保持、完整成员及所求检查依据；构建再核真实工具链和依赖，运行再核相应环境。不把本文件、JSON校验、声明符号存在、构建成功或单次运行互相代签。现状明确为设计内容已提供，生产Reader/实现/工具链绑定、生成、构建、运行及独立Evidence未取得。

Profile修订或源公开行为改变时显式形成后继并冻结新内容/依赖，保留旧输入、旧消费者及其解释，按真实相交变化失效证据；不原地重解释修订1。选择新Profile不等于旧运行退出，只有真实请求涉及运行才产生对应迁移/退役责任。
