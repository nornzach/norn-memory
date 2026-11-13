const en = {
  hierarchy: {
    title: "Memory Hierarchy",
    description:
      "How memories split across the five layers. L0 holds declared principles, L4 holds transient state.",
    loadFailed: "Failed to load hierarchy statistics",
    totalMemories: "Total memories",
    avgImportance: "Average importance",
    contexts: "Contexts",
    canonicalCount: "L0 memories",
    layerLabel: "Layer",
    importanceLabel: "Importance",
    contextLabel: "Context",
    allLayers: "All layers",
    contextBreakdown: "Context breakdown",
    distribution: "Layer distribution",
    share: "Share",
    emptyTitle: "No memories yet",
    emptyDescription: "Add memories and they will be placed in a layer by importance.",
    layers: {
      L0: "Canonical",
      L1: "Core",
      L2: "Episodic",
      L3: "Working",
      L4: "Transient",
    },
    layerDescriptions: {
      L0: "Declared principles and ground truth, never decayed",
      L1: "Stable preferences and skills, ~90 day half-life",
      L2: "Specific events and decisions, ~30 day half-life",
      L3: "Current task context, ~3 day half-life",
      L4: "Transient state and scratch notes, ~1 hour half-life",
    },
  },
};

const zh: typeof en = {
  hierarchy: {
    title: "记忆层次",
    description: "记忆在五层中的分布。L0 是明确声明的原则，L4 是临时状态。",
    loadFailed: "加载层次统计失败",
    totalMemories: "记忆总数",
    avgImportance: "平均重要性",
    contexts: "场景数",
    canonicalCount: "L0 记忆",
    layerLabel: "层级",
    importanceLabel: "重要性",
    contextLabel: "场景",
    allLayers: "所有层级",
    contextBreakdown: "场景分布",
    distribution: "层级分布",
    share: "占比",
    emptyTitle: "还没有记忆",
    emptyDescription: "添加记忆后，会按重要性自动归入对应层级。",
    layers: {
      L0: "规范",
      L1: "核心",
      L2: "情景",
      L3: "工作",
      L4: "瞬时",
    },
    layerDescriptions: {
      L0: "明确声明的原则与基准事实，永不衰减",
      L1: "稳定的偏好与技能，约 90 天半衰期",
      L2: "具体事件与决策，约 30 天半衰期",
      L3: "当前任务上下文，约 3 天半衰期",
      L4: "临时状态与草稿，约 1 小时半衰期",
    },
  },
};

export default { en, zh };
