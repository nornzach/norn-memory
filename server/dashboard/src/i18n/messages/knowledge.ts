const en = {
  knowledge: {
    title: "Knowledge review",
    subtitle:
      "Check proposals against their sources before agents use them as current knowledge.",
    userId: "Memory user ID",
    load: "Load proposals",
    empty: "No pending proposals for this user.",
    review: "Review proposal",
    source: "Evidence source (run, document, or user confirmation)",
    observation: "What the source confirms",
    observedAt: "When that result was observed",
    reason: "Reason for the decision",
    verified: "Verified from source",
    confirmed: "Explicitly confirmed by the user",
    publish: "Publish",
    recheck: "Flag for recheck",
    dismiss: "Dismiss",
    showExchange: "Read submitted exchange",
    edit: "Edit proposal before publishing",
    current: "Compare current revision",
    noProject: "General",
    failed: "Could not complete this request.",
  },
};

const zh: typeof en = {
  knowledge: {
    title: "知识审核",
    subtitle: "先核对依据，再让 Agent 把提案作为当前知识使用。",
    userId: "记忆用户 ID",
    load: "加载提案",
    empty: "该用户没有待审核提案。",
    review: "审核提案",
    source: "证据来源（运行记录、文档或用户确认）",
    observation: "来源能证明什么",
    observedAt: "实际观察时间",
    reason: "处理理由",
    verified: "已核验原始来源",
    confirmed: "用户已明确确认",
    publish: "发布",
    recheck: "标记待复验",
    dismiss: "驳回",
    showExchange: "查看上报对话",
    edit: "发布前修订提案",
    current: "对照现行版本",
    noProject: "通用",
    failed: "请求未完成。",
  },
};

const knowledge = { en, zh };
export default knowledge;
