const en = {
  requests: {
    title: "Requests",
    subtitle: "Recent request logs from your self-hosted instance.",
    loadFailed: "Failed to load request logs",
    columns: {
      time: "Time",
      method: "Method",
      path: "Path",
      status: "Status",
      latency: "Latency",
      key: "API key",
    },
    adminKey: "Admin key",
    keyUnknown:
      "Not recorded: the call was made before keys were tracked, or with a key that didn't work.",
    keyFilter: "API key",
    allKeys: "All keys",
    totalRequests: "Total requests",
    successRate: "Success rate",
    avgLatency: "Avg latency",
    emptyTitle: "No request logs yet",
    emptyDescription:
      "Calls your agents make with an API key show up here. Browsing this dashboard isn't logged.",
    searchPath: "Filter by path",
    statusFilter: "Status",
    statusAll: "All",
    statusOk: "Success",
    statusErrors: "Errors",
    noMatches: "No requests match these filters",
    noMatchesHint: "Try a different path, status or key.",
    lastN: (n: number) => `Last ${n} requests`,
  },
};

const zh: typeof en = {
  requests: {
    title: "请求",
    subtitle: "自托管实例最近的请求日志。",
    loadFailed: "加载请求日志失败",
    columns: {
      time: "时间",
      method: "方法",
      path: "路径",
      status: "状态",
      latency: "延迟",
      key: "API 密钥",
    },
    adminKey: "管理员密钥",
    keyUnknown: "未记录：这次调用发生在开始记录密钥之前，或使用了无效的密钥。",
    keyFilter: "API 密钥",
    allKeys: "全部密钥",
    totalRequests: "请求总数",
    successRate: "成功率",
    avgLatency: "平均延迟",
    emptyTitle: "暂无请求日志",
    emptyDescription:
      "智能体使用 API 密钥发出的调用会显示在这里。浏览此控制台不会被记录。",
    searchPath: "按路径筛选",
    statusFilter: "状态",
    statusAll: "全部",
    statusOk: "成功",
    statusErrors: "错误",
    noMatches: "没有符合筛选条件的请求",
    noMatchesHint: "换个路径、状态或密钥试试。",
    lastN: (n) => `最近 ${n} 条请求`,
  },
};

export default { en, zh };
