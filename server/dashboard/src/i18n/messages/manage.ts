const en = {
  categories: {
    title: "Categories",
    subtitle:
      "New memories are tagged automatically by your configured LLM, using each category's description.",
    loadFailed: "Failed to load categories",
    created: "Category created",
    updated: "Category updated",
    saveFailed: "Failed to save category",
    deleted: "Category deleted",
    deleteFailed: "Failed to delete category",
    taggingStarted: "Tagging started",
    nothingToTag: "Nothing to tag",
    taggingQueued: (count: number) =>
      `Tagging ${count} memories in the background. Refresh in a minute to see updated counts.`,
    allTagged: "Every memory is already tagged.",
    taggingFailed: "Failed to start tagging",
    columns: {
      name: "Name",
      description: "Description",
      memories: "Memories",
      created: "Created",
    },
    editLabel: (name: string) => `Edit ${name}`,
    deleteLabel: (name: string) => `Delete ${name}`,
    tagMenu: "Tag memories",
    tagUntagged: "Tag untagged memories",
    tagUntaggedHint: "Only memories that have never been tagged",
    retagAll: "Re-tag all memories…",
    retagAllHint: "Replace every memory's categories",
    retagTitle: "Re-tag every memory?",
    retagDescription:
      "Each memory goes to your configured LLM again, one call per memory, and its categories are replaced with the ones it picks now, including categories set by hand. Use this after changing category names or descriptions.",
    retagRuns: "It runs in the background; you can keep using the dashboard.",
    retagConfirm: "Re-tag all memories",
    add: "Add category",
    viewMemoriesLabel: (name: string) => `View memories in ${name}`,
    nameRequired: "Enter a name.",
    howItWorks:
      "The LLM reads each description when it tags a memory, so describe what belongs in the category, not just its name.",
    emptyTitle: "No categories yet",
    emptyDescription:
      "Add categories like Health, Preferences or Work. A short description helps the LLM tag memories accurately.",
    editTitle: "Edit category",
    addTitle: "Add category",
    editDescription:
      "Renaming updates every memory already tagged with this category.",
    addDescription:
      "Applies to memories added from now on. Use “Tag memories” for older ones.",
    namePlaceholder: "e.g. Health",
    descriptionPlaceholder:
      "e.g. Medical conditions, allergies, fitness and diet",
    deleteTitle: "Delete category",
    deleteDescription:
      "The category is removed from every memory tagged with it. The memories themselves are kept.",
  },
  webhooks: {
    title: "Webhooks",
    subtitle:
      "Get a signed POST when memories are created, updated, or deleted.",
    loadFailed: "Failed to load webhooks",
    createFailed: "Failed to create webhook",
    updateFailed: "Failed to update webhook",
    testDelivered: "Test delivered",
    testDeliveredDescription: (status: number | null) =>
      `Receiver answered HTTP ${status}.`,
    testFailed: "Test delivery failed",
    noResponse: "No response",
    sendTestFailed: "Failed to send test",
    deleted: "Webhook deleted",
    deleteFailed: "Failed to delete webhook",
    events: {
      "memory.created": "A memory was added",
      "memory.updated": "A memory's text or metadata changed",
      "memory.deleted": "A single memory was deleted",
      "memories.deleted_all":
        "Bulk delete: by user, agent, run, entity, or reset",
    },
    columns: {
      endpoint: "Endpoint",
      events: "Events",
      lastDelivery: "Last delivery",
      active: "Active",
    },
    error: "error",
    toggleLabel: (url: string) => `Toggle ${url}`,
    testLabel: (url: string) => `Send test to ${url}`,
    deleteLabel: (url: string) => `Delete ${url}`,
    add: "Add webhook",
    emptyTitle: "No webhooks yet",
    emptyDescription:
      "Add an endpoint to receive memory events. Each request carries an X-Norn-M-Signature header you can verify with the signing secret.",
    addTitle: "Add webhook",
    addDescription:
      "The server POSTs JSON to this URL. From inside Docker, reach a service on your machine at host.docker.internal.",
    endpointUrl: "Endpoint URL",
    eventsLabel: "Events",
    signingSecret: "Signing secret",
    verifyHint:
      "Verify each request by computing HMAC-SHA256 of the raw body with this secret and comparing it to the X-Norn-M-Signature header (sha256=<hex>).",
    deleteTitle: "Delete webhook",
    deleteDescription: "This endpoint will stop receiving events immediately.",
    edit: "Edit",
    editLabel: (url: string) => `Edit ${url}`,
    editTitle: "Edit webhook",
    editDescription: "Change where events go and which ones are sent.",
    saved: "Webhook saved",
    sendTest: "Send test",
    urlInvalid: "Enter a full http:// or https:// URL.",
    eventsRequired: "Pick at least one event.",
    paused: "Paused",
    activeLabel: "Active",
  },
  exportPage: {
    title: "Export & import",
    subtitle:
      "Download your memories as JSON or CSV, or bring a JSON export back in.",
    importTitle: "Import",
    importDescription:
      "Load a JSON export from this or another Norn-M server. Memories are stored as written, with their owner, categories and source.",
    chooseFile: "Choose a JSON export",
    chooseAnother: "Choose another file",
    fileSummary: (count: number, name: string) =>
      `${count} ${count === 1 ? "memory" : "memories"} in ${name}`,
    fileInvalid: "That file isn't a Norn-M JSON export",
    fileEmpty: "No memories found in that file",
    skipDuplicates: "Skip memories that already exist for the same owner",
    importButton: (count: number) =>
      `Import ${count} ${count === 1 ? "memory" : "memories"}`,
    importing: (done: number, total: number) =>
      `Importing… ${done} of ${total}`,
    importDone: "Import finished",
    importResult: (imported: number, skipped: number, failed: number) =>
      [
        `${imported} imported`,
        skipped ? `${skipped} already there` : "",
        failed ? `${failed} failed` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    importFailed: "Import stopped",
    failedItem: (index: number, error: string) => `#${index + 1}: ${error}`,
    format: "Format",
    sampleOutput: "Sample output",
    exporting: "Exporting…",
    export: "Export memories",
    downloaded: "Export downloaded",
    failed: "Export failed",
    whoTitle: "Whose memories",
    sourceTitle: "Where they came from",
    sourceHint: "Leave empty to include every project, device and agent.",
    jsonHint: "One file with every field, best for re-importing or scripts.",
    csvHint: "Opens in a spreadsheet. Categories are joined with ;",
    projectPlaceholder: "e.g. billing-api",
    devicePlaceholder: "e.g. mac",
    agentPlaceholder: "e.g. claude-code",
    exactTitle: "Exact records",
    exactDescription:
      "Back up passwords, keys, accounts and other exact records with their values, and restore them here or on another Norn-M server.",
    exactExport: "Export exact records",
    exactWarning:
      "The file holds every value in plain text, the same as the records themselves. Keep it somewhere safe.",
    exactChooseFile: "Choose an exact records export",
    exactFileSummary: (count: number, users: number, name: string) =>
      `${count} ${count === 1 ? "record" : "records"} for ${users} ${users === 1 ? "user" : "users"} in ${name}`,
    exactFileInvalid: "That file isn't a Norn-M exact records export",
    exactFileEmpty: "No exact records found in that file",
    exactImportHint:
      "Each record is restored as exported, under its own user. A record that already exists with the same key is replaced and keeps its history.",
    exactImportButton: (count: number) =>
      `Import ${count} ${count === 1 ? "record" : "records"}`,
    exactImporting: (done: number, total: number) =>
      `Importing… ${done} of ${total}`,
    exactImportResult: (created: number, updated: number, unchanged: number) =>
      [
        `${created} created`,
        updated ? `${updated} replaced` : "",
        unchanged ? `${unchanged} unchanged` : "",
      ]
        .filter(Boolean)
        .join(" · "),
  },
  consolidation: {
    title: "Consolidation",
    subtitle:
      "Find memories that repeat or contradict each other. Each run proposes merges and supersedes; nothing changes until you apply them.",
    loadFailed: "Failed to load consolidation runs",
    runLoadFailed: "Failed to load run",
    thresholds: {
      broad: "Broad (0.70)",
      loose: "Loose (0.75)",
      balanced: "Balanced (0.80)",
      strict: "Strict (0.90)",
    },
    runStatus: { running: "Running", completed: "Completed", failed: "Failed" },
    proposalStatus: {
      proposed: "Pending",
      applied: "Applied",
      dismissed: "Dismissed",
      stale: "Stale",
      failed: "Failed",
    },
    kinds: { merge: "Merge", supersede: "Supersede" },
    roles: { delete: "Delete", rewrite: "Rewrite", keep: "Keep" },
    allMemories: "All memories",
    scopeKeys: { user_id: "user", agent_id: "agent", run_id: "run" },
    becomes: "Becomes",
    started: "Consolidation started",
    startedDescription: "Proposals appear here when the scan finishes.",
    startFailed: "Failed to start consolidation",
    proposalStale: "Proposal is stale",
    proposalFailed: "Failed",
    resolveFailed: (action: "apply" | "dismiss"): string =>
      action === "apply"
        ? "Failed to apply proposal"
        : "Failed to dismiss proposal",
    appliedCount: (count: number) =>
      `Applied ${count} proposal${count === 1 ? "" : "s"}`,
    skippedCount: (count: number) =>
      `${count} could not be applied; see the cards for why.`,
    runDeleted: "Run deleted",
    applyFailed: "Failed to apply",
    deleteFailed: "Failed to delete",
    columns: {
      started: "Started",
      scope: "Scope",
      status: "Status",
      pending: "Pending",
    },
    pendingOf: (pending: number, total: number) => `${pending} of ${total}`,
    deleteRun: "Delete run",
    runs: "Runs",
    run: "Run consolidation",
    emptyTitle: "No runs yet",
    emptyDescription:
      "Start a run to scan for near-duplicate and outdated memories. Your configured LLM reviews each group of similar memories and proposes what to do.",
    summary: (scanned: number, groups: number, threshold: string) =>
      `Scanned ${scanned} memories, found ${groups} similar groups at ${threshold} similarity.`,
    thresholdOnly: (threshold: string) => `Similarity threshold ${threshold}.`,
    applyAllPending: (count: number) => `Apply all pending (${count})`,
    scanning: "Scanning memories and asking the LLM about similar groups…",
    runFailed: "The run failed.",
    nothingFound: "No duplicates or outdated memories found.",
    dialogDescription:
      "Leave the IDs empty to scan every memory. Memories are only compared within the same user, agent and run.",
    similarity: "Similarity",
    similarityHint:
      "Contradictions (a changed address or job) are often only about 0.70 similar; higher values only catch restatements.",
    start: "Start",
    confirmApplyTitle: (count: number) =>
      `Apply ${count} pending proposal${count === 1 ? "" : "s"}?`,
    confirmDeleteTitle: "Delete this run?",
    confirmApplyDescription:
      "Merged memories are rewritten and the memories marked Delete are removed. The original text stays readable on each proposal.",
    confirmDeleteDescription:
      "Its proposals and the record of the original memory text are removed. Memories already changed stay changed.",
  },
};

const zh: typeof en = {
  categories: {
    title: "分类",
    subtitle: "新记忆会由你配置的 LLM 根据每个分类的描述自动打上分类标签。",
    loadFailed: "加载分类失败",
    created: "分类已创建",
    updated: "分类已更新",
    saveFailed: "保存分类失败",
    deleted: "分类已删除",
    deleteFailed: "删除分类失败",
    taggingStarted: "已开始打标签",
    nothingToTag: "没有需要打标签的记忆",
    taggingQueued: (count) =>
      `正在后台为 ${count} 条记忆打标签。请稍等片刻后刷新查看最新数量。`,
    allTagged: "所有记忆都已打上标签。",
    taggingFailed: "启动打标签失败",
    columns: {
      name: "名称",
      description: "描述",
      memories: "记忆数",
      created: "创建时间",
    },
    editLabel: (name) => `编辑 ${name}`,
    deleteLabel: (name) => `删除 ${name}`,
    tagMenu: "打标签",
    tagUntagged: "为未打标签的记忆打标签",
    tagUntaggedHint: "只处理从未打过标签的记忆",
    retagAll: "全部重新打标签…",
    retagAllHint: "替换每条记忆的分类",
    retagTitle: "为所有记忆重新打标签？",
    retagDescription:
      "每条记忆都会重新交给已配置的 LLM（每条一次调用），并用它现在选出的分类替换原有分类，手动设置的分类也会被替换。适合在修改分类名称或描述之后使用。",
    retagRuns: "在后台运行，期间可以继续使用控制台。",
    retagConfirm: "全部重新打标签",
    add: "添加分类",
    viewMemoriesLabel: (name) => `查看「${name}」下的记忆`,
    nameRequired: "请填写名称。",
    howItWorks:
      "LLM 打标签时会阅读每个分类的描述，所以请写清楚哪些内容属于这个分类，而不只是写个名字。",
    emptyTitle: "暂无分类",
    emptyDescription:
      "添加如“健康”“偏好”“工作”等分类。简短的描述能帮助 LLM 更准确地打标签。",
    editTitle: "编辑分类",
    addTitle: "添加分类",
    editDescription: "重命名会同步更新所有已打上该分类的记忆。",
    addDescription: "仅对之后新增的记忆生效。旧记忆请使用“打标签”。",
    namePlaceholder: "例如：健康",
    descriptionPlaceholder: "例如：疾病、过敏、健身与饮食",
    deleteTitle: "删除分类",
    deleteDescription: "该分类会从所有已标记的记忆中移除，记忆本身会保留。",
  },
  webhooks: {
    title: "Webhooks",
    subtitle: "在记忆被创建、更新或删除时，接收一条带签名的 POST 请求。",
    loadFailed: "加载 Webhooks 失败",
    createFailed: "创建 Webhook 失败",
    updateFailed: "更新 Webhook 失败",
    testDelivered: "测试已送达",
    testDeliveredDescription: (status) => `接收方返回 HTTP ${status}。`,
    testFailed: "测试投递失败",
    noResponse: "无响应",
    sendTestFailed: "发送测试失败",
    deleted: "Webhook 已删除",
    deleteFailed: "删除 Webhook 失败",
    events: {
      "memory.created": "新增了一条记忆",
      "memory.updated": "记忆的文本或元数据发生变化",
      "memory.deleted": "删除了一条记忆",
      "memories.deleted_all": "批量删除：按用户、Agent、Run、实体删除或重置",
    },
    columns: {
      endpoint: "接收地址",
      events: "事件",
      lastDelivery: "最近投递",
      active: "启用",
    },
    error: "错误",
    toggleLabel: (url) => `切换 ${url}`,
    testLabel: (url) => `向 ${url} 发送测试`,
    deleteLabel: (url) => `删除 ${url}`,
    add: "添加 Webhook",
    emptyTitle: "暂无 Webhook",
    emptyDescription:
      "添加一个接收地址来接收记忆事件。每个请求都带有 X-Norn-M-Signature 请求头，可用签名密钥进行验证。",
    addTitle: "添加 Webhook",
    addDescription:
      "服务器会向此 URL 发送 JSON POST 请求。在 Docker 内访问本机服务，请使用 host.docker.internal。",
    endpointUrl: "接收地址 URL",
    eventsLabel: "事件",
    signingSecret: "签名密钥",
    verifyHint:
      "验证方法：用此密钥对原始请求体计算 HMAC-SHA256，并与 X-Norn-M-Signature 请求头（sha256=<hex>）比对。",
    deleteTitle: "删除 Webhook",
    deleteDescription: "该接收地址将立即停止接收事件。",
    edit: "编辑",
    editLabel: (url) => `编辑 ${url}`,
    editTitle: "编辑 Webhook",
    editDescription: "修改事件的接收地址和要发送的事件。",
    saved: "Webhook 已保存",
    sendTest: "发送测试",
    urlInvalid: "请填写完整的 http:// 或 https:// 地址。",
    eventsRequired: "请至少选择一个事件。",
    paused: "已暂停",
    activeLabel: "启用",
  },
  exportPage: {
    title: "导出与导入",
    subtitle: "将记忆导出为 JSON 或 CSV，或把 JSON 导出文件重新导入。",
    importTitle: "导入",
    importDescription:
      "载入本服务器或其他 Norn-M 服务器的 JSON 导出文件。记忆按原文保存，并保留所属对象、分类和来源。",
    chooseFile: "选择 JSON 导出文件",
    chooseAnother: "选择其他文件",
    fileSummary: (count: number, name: string) =>
      `${name} 中有 ${count} 条记忆`,
    fileInvalid: "这不是 Norn-M 的 JSON 导出文件",
    fileEmpty: "文件中没有记忆",
    skipDuplicates: "跳过同一对象下已存在的记忆",
    importButton: (count: number) => `导入 ${count} 条记忆`,
    importing: (done: number, total: number) => `正在导入… ${done} / ${total}`,
    importDone: "导入完成",
    importResult: (imported: number, skipped: number, failed: number) =>
      [
        `已导入 ${imported} 条`,
        skipped ? `${skipped} 条已存在` : "",
        failed ? `${failed} 条失败` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    importFailed: "导入中断",
    failedItem: (index: number, error: string) => `#${index + 1}：${error}`,
    format: "格式",
    sampleOutput: "输出示例",
    exporting: "导出中…",
    export: "导出记忆",
    downloaded: "导出文件已下载",
    failed: "导出失败",
    whoTitle: "导出谁的记忆",
    sourceTitle: "记忆来源",
    sourceHint: "留空则包含所有项目、设备和 Agent。",
    jsonHint: "单个文件，包含全部字段，适合重新导入或脚本处理。",
    csvHint: "可用表格软件打开，多个分类以 ; 分隔。",
    projectPlaceholder: "例如：billing-api",
    devicePlaceholder: "例如：mac",
    agentPlaceholder: "例如：claude-code",
    exactTitle: "精确记录",
    exactDescription:
      "连同取值一起备份密码、密钥、账号等精确记录，并可恢复到本服务器或其他 Norn-M 服务器。",
    exactExport: "导出精确记录",
    exactWarning: "文件以明文保存所有取值，与记录本身一致。请妥善保管。",
    exactChooseFile: "选择精确记录导出文件",
    exactFileSummary: (count: number, users: number, name: string) =>
      `${name} 中有 ${users} 个用户的 ${count} 条记录`,
    exactFileInvalid: "这不是 Norn-M 的精确记录导出文件",
    exactFileEmpty: "文件中没有精确记录",
    exactImportHint:
      "每条记录按导出时的内容恢复到原用户下。已存在的同名记录会被替换，并保留其历史版本。",
    exactImportButton: (count: number) => `导入 ${count} 条记录`,
    exactImporting: (done: number, total: number) =>
      `正在导入… ${done} / ${total}`,
    exactImportResult: (created: number, updated: number, unchanged: number) =>
      [
        `新建 ${created} 条`,
        updated ? `替换 ${updated} 条` : "",
        unchanged ? `${unchanged} 条无变化` : "",
      ]
        .filter(Boolean)
        .join(" · "),
  },
  consolidation: {
    title: "记忆整合",
    subtitle:
      "找出重复或相互矛盾的记忆。每次运行会给出合并和替换建议；在你应用之前不会做任何修改。",
    loadFailed: "加载整合记录失败",
    runLoadFailed: "加载运行详情失败",
    thresholds: {
      broad: "宽泛（0.70）",
      loose: "较宽（0.75）",
      balanced: "均衡（0.80）",
      strict: "严格（0.90）",
    },
    runStatus: { running: "运行中", completed: "已完成", failed: "失败" },
    proposalStatus: {
      proposed: "待处理",
      applied: "已应用",
      dismissed: "已忽略",
      stale: "已过期",
      failed: "失败",
    },
    kinds: { merge: "合并", supersede: "替换" },
    roles: { delete: "删除", rewrite: "改写", keep: "保留" },
    allMemories: "全部记忆",
    scopeKeys: { user_id: "用户", agent_id: "Agent", run_id: "Run" },
    becomes: "合并为",
    started: "已开始整合",
    startedDescription: "扫描完成后，建议会显示在这里。",
    startFailed: "启动整合失败",
    proposalStale: "建议已过期",
    proposalFailed: "失败",
    resolveFailed: (action) =>
      action === "apply" ? "应用建议失败" : "忽略建议失败",
    appliedCount: (count) => `已应用 ${count} 条建议`,
    skippedCount: (count) => `有 ${count} 条未能应用，原因见对应卡片。`,
    runDeleted: "运行记录已删除",
    applyFailed: "应用失败",
    deleteFailed: "删除失败",
    columns: {
      started: "开始时间",
      scope: "范围",
      status: "状态",
      pending: "待处理",
    },
    pendingOf: (pending, total) => `${pending} / ${total}`,
    deleteRun: "删除运行记录",
    runs: "运行记录",
    run: "开始整合",
    emptyTitle: "暂无运行记录",
    emptyDescription:
      "开始一次运行，扫描近似重复和过时的记忆。你配置的 LLM 会逐组审阅相似记忆并给出处理建议。",
    summary: (scanned, groups, threshold) =>
      `已扫描 ${scanned} 条记忆，在相似度 ${threshold} 下发现 ${groups} 组相似记忆。`,
    thresholdOnly: (threshold) => `相似度阈值 ${threshold}。`,
    applyAllPending: (count) => `全部应用（${count}）`,
    scanning: "正在扫描记忆，并请 LLM 审阅相似的记忆组…",
    runFailed: "运行失败。",
    nothingFound: "没有发现重复或过时的记忆。",
    dialogDescription:
      "ID 留空则扫描全部记忆。只有同一用户、Agent 和 Run 下的记忆才会互相比较。",
    similarity: "相似度",
    similarityHint:
      "相互矛盾的记忆（如地址或工作变更）相似度通常只有 0.70 左右；阈值越高，只能找出换种说法的重复记忆。",
    start: "开始",
    confirmApplyTitle: (count) => `应用 ${count} 条待处理建议？`,
    confirmDeleteTitle: "删除这条运行记录？",
    confirmApplyDescription:
      "被合并的记忆会被改写，标记为“删除”的记忆会被移除。每条建议上仍保留原始文本。",
    confirmDeleteDescription:
      "它的建议及原始记忆文本的记录都会被删除。已修改的记忆保持不变。",
  },
};

export default { en, zh };
