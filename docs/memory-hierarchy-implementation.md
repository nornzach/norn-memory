# Memory Hierarchy Implementation Plan

## Overview
实现五层记忆金字塔系统，带权重、场景隔离、自动演化和可视化界面。

## Milestone 1: 数据模型与基础分层 (Week 1-2)

### Task 1.1: 数据库Schema扩展
- [ ] 在pgvector表中添加新字段：
  ```sql
  ALTER TABLE memories ADD COLUMN layer VARCHAR(2) DEFAULT 'L3';
  ALTER TABLE memories ADD COLUMN importance FLOAT DEFAULT 5.0;
  ALTER TABLE memories ADD COLUMN weight FLOAT;
  ALTER TABLE memories ADD COLUMN context VARCHAR(100) DEFAULT 'chat';
  ALTER TABLE memories ADD COLUMN observed_at TIMESTAMP;
  ALTER TABLE memories ADD COLUMN confidence FLOAT DEFAULT 1.0;
  ALTER TABLE memories ADD COLUMN source VARCHAR(50) DEFAULT 'inferred';
  ALTER TABLE memories ADD COLUMN verified BOOLEAN DEFAULT false;
  ```
- [ ] 添加关系表：
  ```sql
  CREATE TABLE memory_links (
    id UUID PRIMARY KEY,
    from_memory_id UUID REFERENCES memories(id),
    to_memory_id UUID REFERENCES memories(id),
    link_type VARCHAR(20), -- 'linked', 'derived', 'contradicts', 'supersedes'
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```
- [ ] 创建迁移脚本：`alembic/versions/015_memory_hierarchy.py`

### Task 1.2: SDK层次支持
- [ ] `norn_m/memory/hierarchy.py`:
  ```python
  class MemoryLayer(Enum):
      L0_CANONICAL = "L0"
      L1_CORE = "L1"
      L2_EPISODIC = "L2"
      L3_WORKING = "L3"
      L4_TRANSIENT = "L4"
  
  LAYER_BASE_WEIGHTS = {
      "L0": 10.0,
      "L1": 8.0,
      "L2": 5.0,
      "L3": 2.5,
      "L4": 1.0,
  }
  
  LAYER_DECAY_FACTORS = {
      "L0": 1.0,      # 永不衰减
      "L1": 0.9999,   # 半衰期90天
      "L2": 0.999,    # 半衰期30天
      "L3": 0.99,     # 半衰期3天
      "L4": 0.9,      # 半衰期1小时
  }
  
  def calculate_weight(memory, now):
      ...
  ```

### Task 1.3: 重要性评分提取
- [ ] 修改 `norn_m/configs/prompts.py` - `ADDITIVE_EXTRACTION_PROMPT`:
  - 添加重要性评分指南
  - LLM输出格式增加 `"importance": 1-10`
- [ ] 修改 `norn_m/memory/main.py` - extraction逻辑：
  - 解析 importance 字段
  - importance < 3 直接进入 L4
  - importance 3-5 → L3
  - importance 6-7 → L2
  - importance 8-10 → L1

### Task 1.4: 分层检索
- [ ] 修改 `norn_m/vector_stores/pgvector.py` - `search()`:
  ```python
  def search(self, query, top_k=20, context=None, layer_boost=True):
      # 向量相似度搜索
      candidates = self._vector_search(query, top_k * 5)
      
      # 多因素评分
      for mem in candidates:
          relevance = mem.similarity
          recency = self._calculate_recency(mem)
          importance = mem.importance / 10.0
          
          # 上下文加成
          context_boost = 1.5 if context and mem.context == context else 1.0
          
          # 层次权重
          layer_weight = LAYER_BASE_WEIGHTS[mem.layer] / 10.0
          
          score = (
              0.4 * relevance +
              0.3 * importance +
              0.2 * recency +
              0.1 * layer_weight
          ) * context_boost
          
          mem.score = score
      
      return sorted(candidates, key=lambda m: m.score, reverse=True)[:top_k]
  ```

---

## Milestone 2: 场景隔离 (Week 2)

### Task 2.1: Context推断
- [ ] `norn_m/memory/context.py`:
  ```python
  def infer_context(metadata: dict) -> str:
      agent_id = metadata.get('agent_id', '')
      run_id = metadata.get('run_id', '')
      
      # 从agent_id推断
      if 'debug' in agent_id.lower():
          return f"debug-{run_id[:8]}"
      if 'release' in agent_id.lower():
          return f"release-{metadata.get('version', 'unknown')}"
      
      # 从project推断
      project = metadata.get('project')
      if project:
          return f"project-{project}"
      
      return "chat"
  ```

### Task 2.2: API扩展
- [ ] `server/routers/memories.py` - POST `/memories`:
  - 接受 `context` 参数
  - 默认调用 `infer_context()`
- [ ] GET `/memories` - 添加 `context` 过滤

### Task 2.3: MCP工具更新
- [ ] `server/mcp_server.py` - `add_memory`:
  - 添加 `context` 参数说明
  - 自动推断逻辑

---

## Milestone 3: 反思与演化 (Week 3-4)

### Task 3.1: 反思触发器
- [ ] `norn_m/memory/reflection.py`:
  ```python
  class ReflectionEngine:
      def __init__(self, memory_instance):
          self.memory = memory_instance
          self.reflection_threshold = 50  # 每50条新记忆
      
      def should_reflect(self) -> bool:
          # 检查自上次反思以来的新记忆数
          ...
      
      def reflect(self, user_id: str, agent_id: str = None):
          # 1. 获取最近记忆
          recent = self._get_recent_memories(user_id, agent_id, limit=100)
          
          # 2. LLM生成反思问题
          questions = self._generate_questions(recent)
          
          # 3. 为每个问题提炼洞察
          for q in questions:
              insight = self._extract_insight(q, recent)
              if insight:
                  self._store_reflection(insight, user_id, agent_id)
  ```

### Task 3.2: 模式识别
- [ ] prompt模板：
  ```python
  REFLECTION_QUESTIONS_PROMPT = """
  分析最近的记忆，识别模式和高层次洞察。
  
  最近100条记忆：
  {memories}
  
  请生成3-5个问题，帮助提炼高层次理解：
  - 用户在这段时间反复关注什么主题？
  - 是否有新的偏好或技能出现？
  - 是否有模式值得总结？
  
  格式：
  1. [问题]
  2. [问题]
  ...
  """
  
  REFLECTION_INSIGHT_PROMPT = """
  基于以下记忆，回答问题并提炼洞察。
  
  问题：{question}
  
  相关记忆：
  {relevant_memories}
  
  请提供：
  1. 洞察（一句话总结）
  2. 支持证据（引用记忆ID）
  3. 重要性评分（1-10）
  
  格式：
  {{
    "insight": "...",
    "evidence_ids": ["id1", "id2"],
    "importance": 8
  }}
  """
  ```

### Task 3.3: 冲突检测
- [ ] `norn_m/memory/conflict.py`:
  ```python
  def detect_conflicts(new_memory, existing_memories):
      """检测新记忆与已有记忆的冲突"""
      conflicts = []
      
      for mem in existing_memories:
          # 语义相似但结论相反
          if is_contradictory(new_memory.text, mem.text):
              conflicts.append({
                  'memory_id': mem.id,
                  'conflict_type': 'contradiction',
                  'old_text': mem.text,
                  'new_text': new_memory.text
              })
      
      return conflicts
  ```

### Task 3.4: 自动提升/降级
- [ ] 后台任务（每小时）：
  ```python
  async def promote_demote_memories():
      # 提升：L3被引用3次+ → L2
      l3_candidates = await get_frequently_accessed_l3()
      for mem in l3_candidates:
          if mem.access_count >= 3:
              await promote_to_l2(mem)
      
      # 降级：长时间未访问
      for layer in ['L3', 'L4']:
          old_memories = await get_stale_memories(layer)
          for mem in old_memories:
              await demote_or_archive(mem)
  ```

---

## Milestone 4: 规范记忆 (Week 4)

### Task 4.1: L0 API
- [ ] POST `/memories/canonical`:
  ```python
  @router.post("/memories/canonical")
  async def mark_canonical(memory_id: str, scope: KeyScope):
      """用户手动标记为规范记忆"""
      memory = await get_memory(memory_id)
      memory.layer = "L0"
      memory.importance = 10.0
      await update_memory(memory)
  ```

### Task 4.2: 文档导入
- [ ] `norn_m/memory/document_import.py`:
  ```python
  def import_agents_md(file_path: str, user_id: str, project: str):
      """导入AGENTS.md为L0规范记忆"""
      content = read_file(file_path)
      sections = parse_markdown_sections(content)
      
      for section in sections:
          if is_canonical_rule(section):
              create_memory(
                  text=section.text,
                  layer="L0",
                  importance=10.0,
                  context=f"project-{project}",
                  source="document",
                  user_id=user_id
              )
  ```

### Task 4.3: 冲突裁判
- [ ] 在reconcile逻辑中：
  ```python
  def reconcile_with_canonical(new_facts, stored_memories):
      canonical = [m for m in stored_memories if m.layer == "L0"]
      
      for fact in new_facts:
          for canon in canonical:
              if contradicts(fact, canon):
                  # L0优先，拒绝或警告
                  yield {
                      "action": "skip",
                      "reason": f"Contradicts canonical rule: {canon.text}",
                      "fact": fact
                  }
  ```

---

## Milestone 5: Dashboard可视化 (Week 5-6)

### Task 5.1: 数据API
- [ ] GET `/memories/hierarchy-stats`:
  ```json
  {
    "user_id": "zach",
    "layers": {
      "L0": 5,
      "L1": 342,
      "L2": 1823,
      "L3": 156,
      "L4": 42
    },
    "total": 2368,
    "contexts": {
      "chat": 1200,
      "project-norn-memory": 856,
      "project-one-router": 312
    }
  }
  ```

- [ ] GET `/memories/{id}/graph`:
  ```json
  {
    "memory": {...},
    "linked": [
      {"id": "...", "type": "derived", "text": "..."},
      {"id": "...", "type": "contradicts", "text": "..."}
    ],
    "derived_from": [...],
    "supersedes": [...]
  }
  ```

### Task 5.2: React组件

#### A. 层次金字塔视图
```typescript
// server/dashboard/src/components/memories/hierarchy-pyramid.tsx
export function HierarchyPyramid({ stats }) {
  return (
    <div className="pyramid-container">
      {['L0', 'L1', 'L2', 'L3', 'L4'].map(layer => (
        <PyramidLayer 
          key={layer}
          layer={layer}
          count={stats.layers[layer]}
          weight={LAYER_WEIGHTS[layer]}
        />
      ))}
    </div>
  )
}
```

#### B. 记忆详情页增强
```typescript
// server/dashboard/src/components/memories/memory-detail.tsx
function MemoryDetail({ memoryId }) {
  const { data: memory } = useMemory(memoryId)
  const { data: graph } = useMemoryGraph(memoryId)
  
  return (
    <div>
      {/* 基本信息 */}
      <MemoryInfo memory={memory} />
      
      {/* 层次与权重 */}
      <LayerBadge layer={memory.layer} />
      <ImportanceSlider 
        value={memory.importance}
        onChange={updateImportance}
      />
      
      {/* 关系图 */}
      <MemoryGraph data={graph} />
      
      {/* 演化历史 */}
      <EvolutionTimeline memory={memory} />
    </div>
  )
}
```

#### C. 记忆图谱
```typescript
// server/dashboard/src/components/memories/memory-graph.tsx
import ReactFlow from 'reactflow'

function MemoryGraph({ memoryId }) {
  const { nodes, edges } = useMemoryGraphData(memoryId)
  
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={{
        L0: CanonicalNode,
        L1: CoreNode,
        L2: EpisodicNode,
        ...
      }}
    />
  )
}
```

#### D. 层次过滤器
```typescript
// 记忆列表页面添加
<LayerFilter 
  selected={selectedLayers}
  onChange={setSelectedLayers}
/>

<ImportanceRangeFilter
  min={minImportance}
  max={maxImportance}
  onChange={setImportanceRange}
/>

<ContextFilter
  contexts={availableContexts}
  selected={selectedContexts}
  onChange={setSelectedContexts}
/>
```

### Task 5.3: 可视化特性

#### A. 金字塔热力图
- 每层显示数量和平均重要性
- 颜色深度表示活跃度（最近访问频率）
- 点击层级查看该层所有记忆

#### B. 记忆演化时间线
```
L4 (2026-11-13 14:23) "正在调试test失败"
  ↓ 引用3次
L3 (2026-11-13 18:45) "test_server_ingest.py需要patch SessionLocal"
  ↓ 反思提炼
L2 (2026-11-14 09:00) "测试中需要隔离数据库连接"
  ↓ 模式识别
L1 (2026-11-15 10:00) "测试隔离是重要的架构原则"
```

#### C. 冲突检测UI
```typescript
<ConflictAlert>
  <div>
    <h3>检测到冲突</h3>
    <p>新记忆: "用户现在喜欢TypeScript"</p>
    <p>旧记忆: "用户讨厌类型系统" (2024-03-15)</p>
    <Actions>
      <Button onClick={updateOld}>更新旧记忆</Button>
      <Button onClick={keepBoth}>保留两者</Button>
      <Button onClick={rejectNew}>拒绝新记忆</Button>
    </Actions>
  </div>
</ConflictAlert>
```

#### D. 批量操作
- 批量标记L0
- 批量调整importance
- 批量删除L4低价值记忆
- 导出某context所有记忆

---

## Testing Plan

### Unit Tests
- [ ] `tests/memory/test_hierarchy.py`:
  - layer promotion/demotion逻辑
  - weight calculation
  - context inference

- [ ] `tests/memory/test_reflection.py`:
  - pattern recognition
  - conflict detection
  - insight extraction

### Integration Tests
- [ ] `tests/memory/test_hierarchy_integration.py`:
  - 完整的add → reflect → promote流程
  - 跨层检索
  - context隔离

### E2E Tests
- [ ] Dashboard层次视图渲染
- [ ] 记忆升级/降级操作
- [ ] 图谱交互

---

## Migration Strategy

### 现有记忆迁移
```python
# scripts/migrate_to_hierarchy.py

async def migrate_existing_memories():
    """分析现有4310条记忆，分配初始层级"""
    
    memories = await get_all_memories(user_id="zach")
    
    for mem in memories:
        # 1. LLM评估重要性
        importance = await evaluate_importance(mem.text)
        
        # 2. 分配层级
        if importance >= 8:
            layer = "L1"
        elif importance >= 5:
            layer = "L2"
        else:
            layer = "L3"
        
        # 3. 推断context
        context = infer_context_from_metadata(mem.metadata)
        
        # 4. 更新
        await update_memory(
            mem.id,
            layer=layer,
            importance=importance,
            context=context,
            observed_at=mem.created_at
        )
    
    print(f"Migrated {len(memories)} memories")
```

---

## Timeline

| Week | Milestone | Key Deliverables |
|------|-----------|-----------------|
| 1 | M1.1-M1.2 | Schema, SDK hierarchy基础 |
| 2 | M1.3-M2 | 重要性评分, 场景隔离 |
| 3 | M3.1-M3.2 | 反思引擎, 模式识别 |
| 4 | M3.3-M4 | 冲突检测, 规范记忆 |
| 5 | M5.1-M5.2 | API, React组件 |
| 6 | M5.3, Testing | 可视化完善, 测试 |

**Total: 6 weeks**

---

## Success Metrics

1. **质量提升**
   - L4记忆占比 < 10%（当前约50%是流水账）
   - L0/L1记忆覆盖核心偏好和原则
   - 用户反馈"检索到的记忆更相关"

2. **自动演化**
   - 每周至少5条L3→L2提升
   - 每月至少2条L2→L1反思结晶
   - 冲突检测准确率 > 80%

3. **可用性**
   - Dashboard加载金字塔 < 1s
   - 记忆图谱渲染 < 2s
   - 批量操作响应时间 < 5s

4. **用户采用**
   - 至少10条用户手动标记的L0
   - Dashboard层次视图日活 > 50%
   - 导出功能使用率 > 20%
