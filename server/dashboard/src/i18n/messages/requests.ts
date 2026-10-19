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
      auth: "Auth",
    },
    auth: {
      bearer: "JWT",
      apiKey: "API Key",
      adminKey: "Admin Key",
      disabled: "Disabled",
    },
    totalRequests: "Total Requests",
    successRate: "Success Rate",
    avgLatency: "Avg Latency",
    emptyTitle: "No request logs yet",
    emptyDescription:
      "Requests will appear here once your instance receives traffic.",
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
      auth: "认证",
    },
    auth: {
      bearer: "JWT",
      apiKey: "API 密钥",
      adminKey: "管理员密钥",
      disabled: "已禁用",
    },
    totalRequests: "请求总数",
    successRate: "成功率",
    avgLatency: "平均延迟",
    emptyTitle: "暂无请求日志",
    emptyDescription: "实例收到请求后，日志会显示在这里。",
  },
};

export default { en, zh };
