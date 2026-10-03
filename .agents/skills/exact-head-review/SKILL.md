---
name: exact-head-review
description: 用于 frozen exact head 的独立架构、根因、状态图、证据、权限、冗余和文档闭包审查；不用于边实现边审查或用 PR body 代替 diff。
---

# exact-head-review

## 当前归属
Review身份、失效与集成归[Review稳定性](../../../docs/运行/持久化提交与恢复.md#review稳定性批准与merge-queue)；结论强度归[证据与验收](../../../docs/运行/保证/要求证据与裁决.md#设计判断运行事实与最小证据载荷)；真实控制边界归[约束强制](../../../docs/架构/约束强制与整体一致性.md)。报告消费这些拥有者，不能重新定义保证。

## 触发
- candidate已冻结且需要独立 Review、REQUEST_CHANGES处理或 trust-root审计。

## 不触发
- HEAD仍会变化；Reviewer与实现写者没有独立性。

## 输入
- exact base/head/tree、manifest、真实diff、changed records、authority/owner closure、tests、Evidence、threads。
- 与本delta相关的既有finding、约束、事故、失败/恢复窗口和被声明superseded的实现；缺失时列入unknown，不能假定不存在。
- 受影响canonical文档、现有状态/架构图、公共contract、producer/consumer和retirement evidence。

## 前置门禁
- candidate frozen且Reviewer独立；base/head/tree固定。
- required review surface已从changed authority、consumer、Effect/recovery/public contract和显式review policy编译；PR body不能替代该closure。

## 执行
1. 从真实 diff验证 scope、owner、authority和acceptance。
2. 从manifest/ReviewSubject、未结finding和owner投影的bounded prior set复用已有Review记录中的相关约束集合：把相关既有finding/约束/事故逐项绑定到canonical owner和invariant，并证明本candidate从唯一根因消除、由更强合同supersede或以exact evidence判定not-applicable；只修当前反例视为未闭合。prior index缺失时记unknown并交还其owner，禁止为每次Review扫描全部历史Issue/PR/聊天。
3. 对每个finding追到唯一根因：给出`symptom -> enabling mechanism -> failed invariant -> canonical owner -> root repair`因果链。retry、catch、alias、兼容旁路、额外prompt或文档提醒不能冒充根修。
4. 对受影响owner closure复用准确的canonical状态/转换图；现有图不能解释本delta时补充必要差异视图，覆盖`admission/current/invalid-or-unknown/effect/failure/recovery/terminal-or-retirement`；每个节点/边标注owner、authority input、Effect principal和receipt/readback。状态或架构变化时同时显示before/after，并指出非法边由哪个type/Schema/validator/test拒绝。
5. 在受影响闭包内做`redundancy / competing-owner census`：主动寻找第二truth、第二状态机、重复Adapter/wrapper、observer/retry/cleanup/cache、重复字段表/文档/图和无真实consumer的compatibility surface。每个被质疑保留项须有实际consumer、已接受的未来义务或迁移/恢复责任；只有替换中的旧项需要退出条件，不要求合法常驻模块承诺退役。
6. 审查文档与图闭包：代码、machine contract、canonical文档和投影使用同一identity/state vocabulary。先按文档写入准入核实稳定语义和图解缺口；架构/状态迁移改变规范时核唯一canonical owner中的Mermaid或等价可核验图是否同步，既有图准确覆盖时引用复用；缺失或stale duplicate作为finding交原作者修复，read-only Reviewer不直接改规范。Skill、PR body和Review报告只引用，不成为第二产品架构。
7. 主动寻找反向因果、遗漏consumer、弱化断言、临时probe、生成物漂移、自证路径、effect-before-authority、receipt无界增长和无法恢复路径。对strict、atomic、durable、bounded等声明，核其实际消费点、平台/干扰假设及证据观察面；源码上存在检查不证明物理保证，配置并发上限不证明真实启动数受控。
8. 在同一Review记录中列出未知与残留：未覆盖surface、不可用provider、未验证platform/Effect、retained migration与未满足retirement obligation全部显式列出。unknown不能被“未发现”吞掉。
9. 叶节点只有在diff、authority/consumer closure和状态census共同证明不改变状态、Effect、recovery、公共contract或canonical文档时，才可把新图标记为not-applicable；引用适用的canonical graph或原合同，并给出不变性证据；纯值或文本叶节点没有相关状态图时不凭空造图。
10. 将Review绑定exact head、ReviewSubject内required owner revisions和本次review method revision；只有该subject的head/tree或已绑定required owner revision变化才标记STALE。Reviewer环境中的无关dirty、新main或后来发布但未进入ReviewSubject的Skill/owner revision不能污染已冻结candidate，也不能制造机械重审。区分COMMENT、APPROVE、CHANGES_REQUESTED和未解决thread。

Reviewer报告覆盖上述程序涉及的相交问题，可复用精确绑定的已有记录并合并相关项；不要求固定表数、固定标题或第二套持久ledger。某项不适用须说明其依据。实际required surface缺证据或只靠作者prose自证时，terminal为`incomplete`或`unresolved`。

## 完成证据
- 绑定exact base/head/tree、ReviewSubject required owner revisions和review method revision的Review state、P0/P1/P2/advisory findings、threads、REQUEST_CHANGES。
- 相交审查面已有可复核结论或显式unknown；状态关系可追溯到canonical owner及适用依据，相关既有约束有处置，保留/退役理由明确，文档/图无竞争authority。报告格式与图数量本身不证明闭合。

## 停止与恢复
- 给出P0/P1/P2 finding、`incomplete/unresolved/stale`或证据完备的无finding；不得替代物理Gate。
- 被ReviewSubject绑定的head/tree或required owner revision变化时Review为STALE；无关main前进不机械失效。finding交还实现或A0，不直接改码。

## 禁止捷径
- 不把作者自评、PR body、旧 Review或旧 head Evidence当成当前通过。
- 不用“测试绿”“diff很小”“没有发现”替代根因、状态图、冗余、文档与unknown closure。
- 不把整个仓库无差别重画来伪装全貌；图只覆盖受影响owner closure，但必须包含它与上游authority、下游consumer、failure/recovery/retirement的全部相关边。
- 不用全历史/O(history)搜索重建prior constraints；消费owner发布的bounded digest-bound set，相同未失效projection直接复用。
- 不在多个文档或Review报告复制产品状态图；更新唯一canonical owner，其他表面只保留typed reference和本delta解释。
