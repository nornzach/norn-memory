# Norn-M 记忆层次架构设计

## 背景与动机

当前问题：
- **流水账泛滥**：临时状态、测试细节、未确定想法都被记录（"代码未提交"、"live test 步骤"）
- **无价值区分**：核心决策与琐碎细节混在一起，检索时无法优先展示重要信息
- **缺乏结构**：所有记忆平铺存储，没有层次、分类、权重
- **场景混杂**：生产版本记忆与聊天记忆、工作记忆与个人记忆混在一起

目标：建立多层次、带权重、场景隔离的记忆系统，让记忆**有价值、可检索、能演化**。

---

## 一、理论基础

### 1.1 人类记忆分类（认知心理学）

```
记忆系统
├── 显性记忆（可意识访问）
│   ├── 情景记忆（Episodic）：个人经历，时间地点特定
│   │   └── 自传式情景记忆：人生重要事件
│   └── 语义记忆（Semantic）：事实知识，去时间化
│       ├── 个人语义：偏好、技能、特质
│       └── 通用语义：领域知识、概念关系
└── 隐性记忆（无意识影响）
    ├── 程序记忆（Procedural）：技能、习惯
    └── 启动效应（Priming）：短期敏感性
```

### 1.2 AI Agent记忆架构（Stanford Generative Agents 2023）

**三层结构**：
1. **Memory Stream**：所有原始观察的时间流
2. **Reflection**：从观察中提炼的高层次抽象（"Klaus对研究充满热情"）
3. **Planning**：基于记忆和反思的行动计划

**检索评分**：
- **Recency**（新近度）：指数衰减，decay_factor = 0.995
- **Importance**（重要性）：LLM评分1-10
- **Relevance**（相关性）：与查询的余弦相似度

`score = α_recency × recency + α_importance × importance + α_relevance × relevance`

---

## 二、Norn-M 记忆分层设计

### 2.1 记忆层次（五层金字塔）

```
                      ┌─────────────────┐
                      │  L0: 规范记忆   │  ← 最稳定，最高权重
                      │  Canonical      │
                      └─────────────────┘
                            ↑ 结晶
                  ┌─────────────────────┐
                  │   L1: 核心记忆      │  ← 长期稳定，高权重
                  │   Core Semantic     │
                  └─────────────────────┘
                         ↑ 反思/合并
              ┌───────────────────────────┐
              │    L2: 情景记忆          │  ← 中期，事件关联
              │    Episodic              │
              └───────────────────────────┘
                      ↑ 提炼
          ┌─────────────────────────────────┐
          │     L3: 工作记忆               │  ← 短期，高频访问
          │     Working                    │
          └─────────────────────────────────┘
                     ↑ 实时观察
     ┌──────────────────────────────────────────┐
     │        L4: 瞬时缓冲区                   │  ← 临时，快速淘汰
     │        Transient Buffer                 │
     └──────────────────────────────────────────┘
```

#### L0: 规范记忆（Canonical Memory）
- **定义**：用户明确声明的"最高真理"，作为其他记忆的裁判
- **来源**：
  - 用户手动标记："这是我的核心原则"
  - 项目AGENTS.md、README等规范文档
  - 经过多次验证的核心决策
- **特征**：
  - 权重：**10**（最高）
  - 永不衰减（recency = 1.0 恒定）
  - 冲突时优先级最高
  - 需要显式操作才能修改
- **示例**：
  - "用户坚持代码必须有测试覆盖"
  - "项目使用 pnpm，不用 npm"
  - "Norn-M 的核心价值是跨设备记忆同步"

#### L1: 核心记忆（Core Semantic Memory）
- **定义**：去时间化的稳定事实、偏好、技能
- **来源**：
  - 从情景记忆中反思提炼
  - 多次出现的模式结晶
  - 用户确认的重要事实
- **特征**：
  - 权重：**7-9**
  - 慢衰减（半衰期 90 天）
  - 存储：向量 + 结构化字段
- **子类型**：
  - **偏好**："喜欢 Vim 键位"、"早上7点工作效率最高"
  - **技能**："熟练 Rust"、"了解分布式系统"
  - **关系**："与张三是大学同学"
  - **特质**："注重代码简洁性"、"喜欢递归思考问题"
- **示例**：
  - "用户倾向于在提交前先本地测试"
  - "用户对性能优化有强烈偏好"

#### L2: 情景记忆（Episodic Memory）
- **定义**：时间地点明确的事件，保留上下文
- **来源**：
  - 对话中的事件描述
  - 项目里程碑
  - 调试过程、决策记录
- **特征**：
  - 权重：**4-6**
  - 中等衰减（半衰期 30 天）
  - 时间戳、地点、参与者
- **子类型**：
  - **事件**："2026-11-13 部署了异步去重管道"
  - **决策**："选择 PostgreSQL 而非 MySQL，因为 JSON 支持"
  - **教训**："上次直接推送生产导致崩溃，现在先测试"
- **示例**：
  - "2026年11月完成 one-router encrypted_content 修复"
  - "与团队讨论 Norn-M 推广策略，结论是集成到 omp-gui"

#### L3: 工作记忆（Working Memory）
- **定义**：当前活跃任务相关的信息，高频访问
- **来源**：
  - 最近N轮对话
  - 当前任务的上下文
  - 临时变量、中间结果
- **特征**：
  - 权重：**2-3**
  - 快速衰减（半衰期 3 天）
  - Session结束后考虑提升或丢弃
- **示例**：
  - "正在调试 test_server_ingest.py 的失败"
  - "刚才查过 lifespan 函数在 main.py:208"

#### L4: 瞬时缓冲区（Transient Buffer）
- **定义**：极短期的观察，大部分会被丢弃
- **来源**：
  - 工具调用结果
  - 文件读取内容
  - 临时状态
- **特征**：
  - 权重：**0-1**
  - 极快衰减（半衰期 1 小时）
  - 仅在当前上下文窗口有效
  - 90%+ 不会提升到上层
- **示例**：
  - "代码未提交"（临时状态）
  - "测试步骤3：启动网关"（过程细节）

---

### 2.2 记忆维度与标签

每条记忆携带多维度元数据：

#### A. 核心维度

```python
class Memory:
    # 层次与权重
    layer: Literal["L0", "L1", "L2", "L3", "L4"]
    importance: float  # 0-10，LLM评分
    weight: float      # 实时权重 = base_weight × recency_decay
    
    # 分类
    category: str      # 自动分类："preference", "skill", "event", "decision", ...
    tags: list[str]    # 手动或自动标签：["rust", "performance", "production"]
    
    # 场景隔离
    scope: MemoryScope
    context: str       # "chat", "project-release", "debug-session", "research"
    
    # 时间
    created_at: datetime
    last_accessed_at: datetime
    observed_at: datetime  # 事件实际发生时间（可能早于创建时间）
    
    # 关系
    linked_memories: list[str]     # 关联记忆ID
    derived_from: list[str]        # 从哪些记忆提炼而来
    contradicts: list[str]         # 与哪些记忆冲突
    supersedes: list[str]          # 取代哪些旧记忆
    
    # 验证
    confidence: float   # 0-1，信息可信度
    source: str         # "user-stated", "inferred", "observed", "document"
    verified: bool      # 是否经过验证
```

#### B. 场景标记（Context Isolation）

| Context | 用途 | 检索范围 | 保留期 |
|---------|-----|---------|--------|
| `chat` | 日常聊天 | 跨会话 | 按重要性 |
| `project-{name}` | 特定项目工作 | 项目内 | 项目生命周期 |
| `debug-{issue}` | 调试会话 | 隔离 | 问题解决后清理 |
| `research-{topic}` | 调研 | 主题内 | 长期保留核心结论 |
| `planning` | 规划设计 | 跨项目 | 执行后归档 |
| `release-{version}` | 版本发布 | 版本内 | 永久（里程碑） |

**规则**：
- 同一context内的记忆检索优先级更高
- 不同context的记忆默认不互相污染
- 可显式跨context检索（如"调试时查看历史类似问题"）

---

### 2.3 重要性评分准则

**提取时LLM判断**（prompt改进）：

```
对以下信息评分（1-10）：

【高分（7-10）- 应该长期记住】
- 核心决策及其理由（"为什么选择X而非Y"）
- 里程碑事件（项目启动、完成、上线）
- 教训与反思（"X失败了，学到..."）
- 稳定的偏好/技能/关系
- 重要的问题与其解决方案（"如何修复Y bug"）
- 用户明确要求记住的内容

【中分（4-6）- 可能有用】
- 具体实现细节（有完整上下文）
- 讨论中的建议（未最终决定）
- 短期计划（"本周要做X"）
- 工具使用记录（"用Z库实现了W"）

【低分（1-3）- 流水账，应丢弃】
- 临时状态（"代码未提交"、"测试运行中"）
- 过程细节（"测试步骤1: ..."、"先执行A再执行B"）
- 重复的例行操作（"早上检查邮件"）
- 已完成的待办（无后续影响）
- 头脑风暴中被否决的想法

当不确定时，优先考虑：是否可复用？是否影响未来决策？6个月后还有用吗？
```

---

### 2.4 记忆演化机制

#### A. 提升（Promote）

```
L4 → L3：在session中被引用3次以上
L3 → L2：跨session被引用，或用户确认重要
L2 → L1：
  - 同主题出现5次以上 → 提炼模式
  - 用户多次验证 → 结晶为核心事实
L1 → L0：用户显式标记为"规范"
```

#### B. 降级（Demote）

```
长时间未访问 + 低重要性 → 降级或归档
L3 → L4 → 删除：7天未访问的低分记忆
L2 → L3：30天未访问且importance < 5
```

#### C. 反思（Reflection）

定期（每N条新记忆 或 每天）触发：

1. **模式识别**：
   - "用户在过去两周讨论了5次性能优化 → 提炼：用户对性能有持续关注"
   - 提升为L1核心记忆

2. **冲突检测**：
   - 新记忆："用户现在喜欢 TypeScript"
   - 旧记忆："用户讨厌类型系统"
   - → 标记冲突，询问用户或根据时间更新

3. **合并去重**：
   - 相似度>0.9的L2记忆 → 合并为更完整的一条
   - 记录 `derived_from` 链

#### D. 遗忘（Forgetting）

不是删除，是降低权重 + 归档：

```python
def calculate_weight(memory):
    base = LAYER_BASE_WEIGHTS[memory.layer]
    
    # 衰减
    hours_since_access = (now - memory.last_accessed_at).total_seconds() / 3600
    decay_factor = LAYER_DECAY_FACTORS[memory.layer]
    recency = decay_factor ** hours_since_access
    
    # L0规范记忆永不衰减
    if memory.layer == "L0":
        recency = 1.0
    
    return base * memory.importance * recency
```

---

### 2.5 检索策略

#### A. 混合检索

```python
def retrieve(query, context, top_k=20):
    # 1. 粗筛：向量相似度
    candidates = vector_search(query, top_k=100)
    
    # 2. 精排：多因素评分
    for mem in candidates:
        relevance = cosine_sim(mem.embedding, query.embedding)
        recency = calculate_recency(mem)
        importance = mem.importance / 10.0
        
        # 上下文加成
        context_boost = 1.5 if mem.context == context else 1.0
        
        # 层次权重
        layer_boost = LAYER_WEIGHTS[mem.layer]
        
        score = (
            0.4 * relevance +
            0.3 * importance +
            0.2 * recency +
            0.1 * layer_boost
        ) * context_boost
        
        mem.retrieval_score = score
    
    # 3. 层次优先：确保高层次记忆优先
    results = sorted(candidates, key=lambda m: (
        -m.retrieval_score,
        -LAYER_RANKS[m.layer]
    ))
    
    return results[:top_k]
```

#### B. 层次偏好

不同任务偏好不同层次：

| 任务类型 | 偏好层次 | 原因 |
|---------|---------|------|
| 回答"你是谁" | L0 > L1 | 需要稳定身份 |
| 规划新项目 | L1 > L2 | 需要技能+偏好 |
| 回忆具体事件 | L2 > L3 | 需要时间地点 |
| 继续当前工作 | L3 > L2 | 需要上下文 |
| 学习新模式 | L2 > L1 | 从案例归纳 |

---

## 三、实现路线图

### Phase 1: 基础分层（2周）

- [ ] 数据模型扩展：添加 layer, importance, weight, context 字段
- [ ] 迁移脚本：现有记忆分析并分配初始层级
- [ ] 重要性评分：改进extraction prompt，LLM输出 importance
- [ ] 简单衰减：基于时间的 recency 计算
- [ ] 分层检索：retrieval 加入 layer 权重

### Phase 2: 场景隔离（1周）

- [ ] Context 字段：chat, project-*, debug-*, release-*
- [ ] API 扩展：add/search 时指定 context
- [ ] Context 推断：从 agent_id, metadata 自动判断
- [ ] 隔离检索：默认同context优先

### Phase 3: 反思与演化（2周）

- [ ] 反思触发：每50条新记忆或每天
- [ ] 模式识别：LLM扫描最近记忆，提炼高层次洞察
- [ ] 冲突检测：新旧记忆语义对比
- [ ] 自动提升：被频繁引用的L3 → L2
- [ ] 合并去重：相似L2记忆合并

### Phase 4: 规范记忆（1周）

- [ ] L0 API：用户标记"规范记忆"
- [ ] 文档导入：AGENTS.md 自动提取为 L0
- [ ] 冲突裁判：L0优先级最高

### Phase 5: Dashboard 可视化（1周）

- [ ] 记忆层次视图：金字塔可视化
- [ ] 记忆图谱：linked_memories 关系图
- [ ] 重要性编辑：手动调整 importance/layer
- [ ] 遗忘预览：即将降级的记忆

---

## 四、示例场景

### 场景1：从流水账到核心记忆

**输入**（当前会出现的流水账）：
```
[L4] "one-router-new 的 encrypted_content 亲和修复代码仍未提交"
[L4] "测试步骤1: 启动网关"
[L4] "测试步骤2: 发送请求"
...（10条测试细节）
[L3] "修复了 encrypted_content 的 affinity 问题"
[L2] "OpenAI 和 Azure GPT 的 encrypted_content 需要 affinity 绑定避免解密失败"
```

**演化后**（分层存储）：
```
[L1] "one-router-new 需要 encrypted_content affinity 绑定：OpenAI/Azure 流式响应加密后，后续chunk需要同一节点解密"
      ← 从10+条L3/L2记忆反思提炼
      importance: 8
      tags: ["one-router", "encryption", "architecture"]
      context: "project-one-router"

[L2] "2026-11-13 完成 encrypted_content affinity 修复，通过 live test 验证"
      importance: 6
      linked_memories: [L1核心记忆ID]

[L4] "测试步骤..."（24小时后自动清理）
```

### 场景2：规范记忆防止偏离

**用户设置** `L0`：
```
"Norn-M 的核心原则：
 1. 用户数据永远本地优先，云端是可选的同步层
 2. 记忆提取必须可解释，不能是黑盒
 3. 用户可以随时导出/删除所有数据"
```

**对话中Agent建议**：
"我们可以把记忆全部存在云端，用户通过API访问"

**系统检测冲突**：
```
新建议 vs L0规范记忆
→ 冲突："云端优先" contradicts "本地优先"
→ 提示Agent："这与用户核心原则冲突，请重新考虑"
```

### 场景3：场景隔离

**Release context**:
```
context: "release-v2.0"
memories:
  - [L2] "v2.0 引入异步去重管道"
  - [L2] "v2.0 reconcile 功能上线"
  - [L1] "v2.0 是 Norn-M 的重要里程碑：首次实现智能去重"
```

**Debug context**:
```
context: "debug-test-failure-2026-11-13"
memories:
  - [L3] "test_server_ingest.py 失败因为 logger 未定义"
  - [L3] "修复：用 logging.info 替换 logger.info"
  - [L3] "部署后验证通过"
```

问题解决后，debug context 自动降级或清理，保留教训：
```
→ [L2] "Python lifespan 中要用 logging 模块而非 logger 变量"
   context: "chat"  # 提升到通用上下文
   importance: 5
```

---

## 五、关键改进点总结

### 相比当前系统

| 维度 | 当前 | 改进后 |
|-----|------|--------|
| **层次** | 平铺 | 5层金字塔，清晰演化路径 |
| **权重** | 无 | importance(1-10) + 衰减 + 层次权重 |
| **过滤** | 提取所有 | 严格重要性评分，流水账直接丢弃 |
| **场景** | 混杂 | context隔离，避免污染 |
| **演化** | 静态 | 反思/提升/合并，自动精炼 |
| **规范** | 无 | L0锁定核心原则，防偏离 |
| **关系** | 弱 | linked/derived/contradicts 明确关联 |

### 预期效果

1. **减少90%的流水账**：importance<3 直接丢弃或进L4快速淘汰
2. **核心记忆突出**：L0/L1 检索优先，稳定且可靠
3. **场景不混杂**：release 记忆不污染 debug session
4. **自动精炼**：L2→L1 反思提炼模式，减少冗余
5. **可控可调**：用户可标记L0、手动调整层级

---

## 六、待讨论问题

1. **反思频率**：每50条？每天？还是用户触发？
2. **遗忘策略**：真删除还是归档？归档后还能搜到吗？
3. **层次晋升**：完全自动还是需要用户确认？
4. **Context分配**：如何准确判断一条记忆属于哪个context？
5. **向后兼容**：现有4310条记忆如何迁移分层？
6. **性能开销**：反思和检索的LLM调用成本？
