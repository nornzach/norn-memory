const en = {
  memories: {
    title: "Memories",
    loadFailed: "Failed to load memories",
    deleted: "Memory deleted",
    deleteFailed: "Failed to delete memory",
    columns: {
      content: "Content",
      categories: "Categories",
      user: "User",
      agent: "Agent",
      created: "Created",
    },
    userFilter: "Filter by User ID (optional)",
    categoryFilter: "Filter by category",
    emptyCategoryTitle: "No memories in this category",
    emptyCategoryDescription:
      "New memories are tagged in the background, so recent ones can take a few seconds to appear.",
    emptyTitle: "No memories yet",
    emptyDescription:
      "Create your first memory by sending a POST /memories request.",
    emptyFilterTitle: "No memories match these filters",
    emptyFilterDescription:
      "Only memories written after provenance was added record a project, device and agent.",
    restReference: "REST API reference",
    detailTitle: "Memory Detail",
    detailDescription: "View memory content and metadata",
    noCategories: "None yet",
    id: "ID",
    deleteMemory: "Delete memory",
    deleteTitle: "Delete memory",
    deleteDescription:
      "This memory will be permanently removed. This cannot be undone.",
  },
  entities: {
    title: "Entities",
    loadFailed: "Failed to load entities",
    deleted: "Entity deleted",
    deleteFailed: "Failed to delete entity",
    types: { user: "User", agent: "Agent", run: "Run" },
    columns: {
      type: "Type",
      id: "ID",
      memories: "Memories",
      lastActive: "Last Active",
    },
    deleteLabel: (id: string) => `Delete ${id}`,
    emptyTitle: "No entities yet",
    emptyDescription:
      "Entities appear once memories are stored with a user_id, agent_id, or run_id.",
    deleteTitle: "Delete entity",
    deleteDescription:
      "All memories associated with this entity will be permanently removed. This cannot be undone.",
  },
};

const zh: typeof en = {
  memories: {
    title: "记忆",
    loadFailed: "加载记忆失败",
    deleted: "记忆已删除",
    deleteFailed: "删除记忆失败",
    columns: {
      content: "内容",
      categories: "分类",
      user: "用户",
      agent: "Agent",
      created: "创建时间",
    },
    userFilter: "按用户 ID 筛选（可选）",
    categoryFilter: "按分类筛选",
    emptyCategoryTitle: "该分类下暂无记忆",
    emptyCategoryDescription:
      "新记忆会在后台自动打标签，最近添加的记忆可能需要几秒钟才会出现。",
    emptyTitle: "暂无记忆",
    emptyDescription: "发送一个 POST /memories 请求来创建你的第一条记忆。",
    emptyFilterTitle: "没有符合筛选条件的记忆",
    emptyFilterDescription:
      "只有启用来源记录之后写入的记忆才带有项目、设备和 Agent。",
    restReference: "REST API 参考",
    detailTitle: "记忆详情",
    detailDescription: "查看记忆内容和元数据",
    noCategories: "暂无",
    id: "ID",
    deleteMemory: "删除记忆",
    deleteTitle: "删除记忆",
    deleteDescription: "此记忆将被永久删除，且无法恢复。",
  },
  entities: {
    title: "实体",
    loadFailed: "加载实体失败",
    deleted: "实体已删除",
    deleteFailed: "删除实体失败",
    types: { user: "用户", agent: "Agent", run: "Run" },
    columns: {
      type: "类型",
      id: "ID",
      memories: "记忆数",
      lastActive: "最近活跃",
    },
    deleteLabel: (id) => `删除 ${id}`,
    emptyTitle: "暂无实体",
    emptyDescription:
      "当记忆带有 user_id、agent_id 或 run_id 时，对应的实体会显示在这里。",
    deleteTitle: "删除实体",
    deleteDescription: "与该实体关联的所有记忆都将被永久删除，且无法恢复。",
  },
};

export default { en, zh };
