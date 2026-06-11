const state = {
  stream: null,
  templates: [],
  busy: false,
  referenceVisible: false,
  lastRequestId: "",
  lastWatchPayload: null,
  retestRound: loadRetestRound(),
  clientSessionId: "",
  watchRefreshTimers: [],
};

const MOTION_SIG_WIDTH = 32;
const MOTION_SIG_HEIGHT = 24;

const TARGET_CUES = {
  花: "重点看开花手势：一只手从撮合到张开，手指绽放过程要清楚入画。",
  跳: "重点看双手关系：左手作为地面稳定入画，右手食指/中指在左手上方完成弹跳。",
  香蕉: "重点看剥皮关系：一手竖食指作为香蕉，另一手沿食指向下剥开。",
  汽车: "重点看双手虚握与转动：两手像握方向盘一样同步转动。",
  唱歌: "重点看嘴部和双手：嘴巴张开，双手从喉部两侧向外移动。",
};

const CAPTURE_RECOMMENDATIONS = {
  花: { minFrames: 12, minDurationSec: 2.5, minFps: 5 },
  跳: { minFrames: 6, minDurationSec: 2, minFps: 5 },
  default: { minFrames: 10, minDurationSec: 2.5, minFps: 5 },
};

const WATCH_REFRESH_AFTER_SCORE_DELAYS_MS = [5000, 25000, 45000, 75000, 120000];

function ensureClientSessionId() {
  if (state.clientSessionId) return state.clientSessionId;
  const storageKey = "signLanguageClientSessionId";
  let sessionId = "";
  try {
    sessionId = localStorage.getItem(storageKey) || "";
  } catch (err) {
    sessionId = "";
  }
  if (!sessionId) {
    const randomPart = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionId = `browser_${randomPart}`;
    try {
      localStorage.setItem(storageKey, sessionId);
    } catch (err) {
      // Keep the in-memory value if localStorage is unavailable.
    }
  }
  state.clientSessionId = sessionId;
  return sessionId;
}

const els = {
  workerStatus: document.getElementById("workerStatus"),
  cameraStatus: document.getElementById("cameraStatus"),
  mediaRow: document.getElementById("mediaRow"),
  referenceToggle: document.getElementById("referenceToggle"),
  preview: document.getElementById("preview"),
  countdownOverlay: document.getElementById("countdownOverlay"),
  countdownValue: document.getElementById("countdownValue"),
  referenceVideo: document.getElementById("referenceVideo"),
  referenceLabel: document.getElementById("referenceLabel"),
  canvas: document.getElementById("captureCanvas"),
  targetWord: document.getElementById("targetWord"),
  durationSec: document.getElementById("durationSec"),
  captureFps: document.getElementById("captureFps"),
  frameWidth: document.getElementById("frameWidth"),
  captureHint: document.getElementById("captureHint"),
  cameraBtn: document.getElementById("cameraBtn"),
  recordBtn: document.getElementById("recordBtn"),
  progressBar: document.getElementById("progressBar"),
  captureLog: document.getElementById("captureLog"),
  scoreRing: document.getElementById("scoreRing"),
  scoreValue: document.getElementById("scoreValue"),
  resultTitle: document.getElementById("resultTitle"),
  resultNote: document.getElementById("resultNote"),
  requestMeta: document.getElementById("requestMeta"),
  requestId: document.getElementById("requestId"),
  copyRequestBtn: document.getElementById("copyRequestBtn"),
  dtwDistance: document.getElementById("dtwDistance"),
  normDistance: document.getElementById("normDistance"),
  workerTime: document.getElementById("workerTime"),
  frameCount: document.getElementById("frameCount"),
  targetCue: document.getElementById("targetCue"),
  groupMetrics: document.getElementById("groupMetrics"),
  penaltyMetrics: document.getElementById("penaltyMetrics"),
  diagnosticMetrics: document.getElementById("diagnosticMetrics"),
  watchStatusEvent: document.getElementById("watchStatusEvent"),
  watchTargetCount: document.getElementById("watchTargetCount"),
  watchGeneratedAt: document.getElementById("watchGeneratedAt"),
  watchGoalStatus: document.getElementById("watchGoalStatus"),
  watchMissingGates: document.getElementById("watchMissingGates"),
  watchWordCoverage: document.getElementById("watchWordCoverage"),
  watchNextStep: document.getElementById("watchNextStep"),
  prepareRetestBtn: document.getElementById("prepareRetestBtn"),
  refreshWatchBtn: document.getElementById("refreshWatchBtn"),
  retestRoundStatus: document.getElementById("retestRoundStatus"),
  watchStatusNote: document.getElementById("watchStatusNote"),
  watchReportMeta: document.getElementById("watchReportMeta"),
};

function setLog(text) {
  els.captureLog.textContent = text;
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatWatchSampleSummaries(samples) {
  if (!Array.isArray(samples) || !samples.length) return "";
  const triageLabels = {
    normal: "正常",
    borderline_review: "边界复查",
    semantic_mismatch: "语义不足",
    recapture: "建议重采",
    low_review: "低分复查",
    error: "错误",
  };
  return samples.slice(0, 3).map((row) => {
    const word = row.target_word || "--";
    const score = formatNumber(row.score, 1);
    const triage = triageLabels[row.triage_priority] || row.triage_priority || "--";
    const advice = row.sample_advice || "查看语义诊断报告。";
    return `${word} ${score}分 ${triage}：${advice}`;
  }).join("；");
}

function formatWatchConfusionSummaries(samples) {
  if (!Array.isArray(samples) || !samples.length) return "";
  return samples.slice(0, 3).map((row) => {
    const word = row.target_word || "--";
    const other = row.other_word || "--";
    const score = formatNumber(row.target_score, 1);
    const otherScore = formatNumber(row.other_score, 1);
    const margin = formatNumber(row.margin, 1);
    const gate = row.confusion_pass ? "交叉通过" : (row.eligible_for_gate ? "交叉需复查" : "交叉跳过");
    return `${word}/${other} ${score}-${otherScore} margin ${margin} ${gate}`;
  }).join("；");
}

function formatWordCoverage(words) {
  if (!Array.isArray(words) || !words.length) return "-";
  return words.filter(Boolean).join("、") || "-";
}

function formatBrowserCaptureEvidence(readiness) {
  const evidence = readiness?.browser_capture_evidence || {};
  const rows = Array.isArray(evidence.rows) ? evidence.rows : [];
  const ids = Array.isArray(evidence.request_ids)
    ? evidence.request_ids
    : rows.map((row) => row.request_id).filter(Boolean);
  const requiredWords = Array.isArray(evidence.required_words) ? evidence.required_words : [];
  const observedWords = Array.isArray(evidence.observed_words) ? evidence.observed_words : [];
  const missingWords = Array.isArray(evidence.missing_required_words) ? evidence.missing_required_words : [];
  const requiredText = requiredWords.length ? `；要求覆盖 ${formatWordCoverage(requiredWords)}` : "";
  const observedText = observedWords.length ? `；已覆盖 ${formatWordCoverage(observedWords)}` : "";
  const missingText = missingWords.length ? `；缺失词条 ${formatWordCoverage(missingWords)}` : "";
  if (evidence.passed) {
    const shown = ids.slice(0, 3).join(", ") || `${rows.length}个样本`;
    const levels = [...new Set(rows.map((row) => row.evidence_level).filter(Boolean))];
    const suffix = levels.length ? `（${levels.join("/")}）` : "";
    return `真实采集证据通过：${shown}${suffix}${observedText || requiredText}`;
  }
  if (!rows.length) {
    return `真实采集证据暂无：marker 后还没有新增浏览器花/跳样本${requiredText}${missingText}。`;
  }
  if (evidence.sample_evidence_passed && missingWords.length) {
    const shown = ids.slice(0, 3).join(", ") || `${rows.length}个样本`;
    return `真实采集样本证据通过但覆盖不足：${shown}${observedText}${requiredText}${missingText}`;
  }
  const failed = rows.filter((row) => !row.passed);
  const reasons = failed.slice(0, 3).map((row) => {
    const word = row.target_word || "--";
    const rid = row.request_id || "--";
    const frames = row.frame_count ?? "--";
    const level = row.evidence_level || "none";
    const reason = row.reason || "not_browser_capture_like";
    return `${word} ${rid} ${frames}帧 ${level}:${reason}`;
  });
  return `真实采集证据未通过：${reasons.join("；")}${observedText}${requiredText}${missingText}`;
}

function renderWatchWordCoverage(readiness, fallbackWords = []) {
  if (!els.watchWordCoverage) return;
  const evidence = readiness?.browser_capture_evidence || {};
  const rows = Array.isArray(evidence.rows) ? evidence.rows : [];
  const requiredWords = Array.isArray(evidence.required_words) && evidence.required_words.length
    ? evidence.required_words
    : fallbackWords;
  const observed = new Set(Array.isArray(evidence.observed_words) ? evidence.observed_words : []);
  const missing = new Set(Array.isArray(evidence.missing_required_words) ? evidence.missing_required_words : []);
  const failed = new Set(rows.filter((row) => !row.passed && row.target_word).map((row) => row.target_word));

  els.watchWordCoverage.innerHTML = "";
  if (!requiredWords.length) {
    els.watchWordCoverage.hidden = true;
    return;
  }
  for (const word of requiredWords) {
    const chip = document.createElement("span");
    chip.className = "watch-word-chip";
    let stateClass = "pending";
    let stateText = "待采集";
    if (observed.has(word)) {
      stateClass = "covered";
      stateText = "已覆盖";
    } else if (failed.has(word)) {
      stateClass = "failed";
      stateText = "需复查";
    } else if (missing.has(word)) {
      stateClass = "missing";
      stateText = "缺失";
    }
    chip.classList.add(`watch-word-chip-${stateClass}`);
    chip.textContent = `${word} ${stateText}`;
    els.watchWordCoverage.appendChild(chip);
  }
  els.watchWordCoverage.hidden = false;
}

function renderWatchNextRetestStep(readiness, fallbackWords = []) {
  if (!els.watchNextStep) return;
  const evidence = readiness?.browser_capture_evidence || {};
  const rows = Array.isArray(evidence.rows) ? evidence.rows : [];
  const requiredWords = Array.isArray(evidence.required_words) && evidence.required_words.length
    ? evidence.required_words
    : fallbackWords;
  const observed = new Set(Array.isArray(evidence.observed_words) ? evidence.observed_words : []);
  const missingWords = Array.isArray(evidence.missing_required_words) ? evidence.missing_required_words : [];
  const failedWords = [...new Set(rows.filter((row) => !row.passed && row.target_word).map((row) => row.target_word))];

  let text = "";
  if (failedWords.length) {
    text = `下一步复测：复查 ${formatWordCoverage(failedWords)}`;
  } else if (missingWords.length) {
    text = `下一步复测：采集 ${formatWordCoverage(missingWords)}`;
  } else if (requiredWords.length && requiredWords.every((word) => observed.has(word))) {
    text = `下一步复测：${formatWordCoverage(requiredWords)} 覆盖完成`;
  } else if (requiredWords.length) {
    text = `下一步复测：采集 ${formatWordCoverage(requiredWords)}`;
  }

  els.watchNextStep.textContent = text;
  els.watchNextStep.hidden = !text;
}

function formatReadinessSummary(readiness) {
  const summary = readiness?.readiness_summary || {};
  if (!summary || typeof summary !== "object" || !Object.keys(summary).length) return "";
  const runtime = summary.runtime_ready ? "运行态通过" : "运行态缺失";
  const algorithm = summary.algorithm_ready ? "算法质量通过" : "算法质量缺失";
  const realSample = summary.real_sample_ready ? "真实复测通过" : "真实复测缺失";
  const blocker = summary.completion_blocker ? `，阻塞：${summary.completion_blocker}` : "";
  return `${runtime}，${algorithm}，${realSample}${blocker}`;
}

function formatFrontendContractCheck(contract) {
  if (!contract || typeof contract !== "object") return "";
  const status = contract.status || (contract.returncode === 0 ? "PASS" : "FAIL");
  const failed = Number(contract.failed_count || 0);
  const artifactFailed = Number(contract.artifact_url_failed_count || 0);
  const artifactCount = Number(contract.artifact_url_count || 0);
  const label = status === "PASS" && failed === 0 && artifactFailed === 0
    ? "前端诊断链路通过"
    : "前端诊断链路需复查";
  const artifactText = artifactCount ? `，报告/骨架链接 ${artifactCount - artifactFailed}/${artifactCount}` : "";
  return `${label}：${status}，失败 ${failed}，链接失败 ${artifactFailed}${artifactText}`;
}

function renderWatchArtifactLinks(container, artifacts, fallbackParts) {
  const linkItems = [];
  if (artifacts?.index_url) {
    linkItems.push({ label: "诊断汇总", url: artifacts.index_url });
  }
  if (artifacts?.manifest_url) {
    linkItems.push({ label: "镜像清单", url: artifacts.manifest_url });
  }
  for (const item of artifacts?.reports || []) {
    if (item?.url) linkItems.push({ label: item.label || item.kind || "报告", url: item.url });
  }
  const visualLinks = (artifacts?.visuals || [])
    .filter((item) => item?.url && item.kind !== "visual_summary")
    .slice(0, 8);
  for (const item of visualLinks) {
    linkItems.push({ label: item.label || item.kind || "骨架图", url: item.url });
  }

  container.replaceChildren();
  if (!linkItems.length) {
    container.textContent = `最近报告：${fallbackParts.join("；")}`;
    return;
  }
  container.appendChild(document.createTextNode("最近报告："));
  linkItems.forEach((item, idx) => {
    if (idx > 0) {
      container.appendChild(document.createTextNode("；"));
    }
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = item.label;
    container.appendChild(link);
  });
}

function loadRetestRound() {
  try {
    const raw = window.localStorage.getItem("signLanguageRetestRound");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveRetestRound(round) {
  state.retestRound = round;
  try {
    if (round) {
      window.localStorage.setItem("signLanguageRetestRound", JSON.stringify(round));
    } else {
      window.localStorage.removeItem("signLanguageRetestRound");
    }
  } catch (err) {
    // Local storage is only a UI convenience; ignore browser privacy failures.
  }
  updateRetestRoundStatus();
}

function currentMarkerId() {
  const payload = state.lastWatchPayload || {};
  const status = payload.status || {};
  return status.marker_last_request_id || "";
}

function updateRetestRoundStatus() {
  if (!els.retestRoundStatus) return;
  const markerId = currentMarkerId();
  const round = state.retestRound;
  if (!round?.marker_id) {
    els.retestRoundStatus.textContent = markerId ? `当前 marker ${markerId}` : "等待 watcher";
    return;
  }
  const markerChanged = markerId && markerId !== round.marker_id;
  els.retestRoundStatus.textContent = markerChanged
    ? `已诊断到 ${markerId}`
    : `复测中 ${round.marker_id}`;
}

function prepareRetestRound() {
  const markerId = currentMarkerId();
  if (!markerId) {
    setLog("暂未读取到 watcher marker；请等待自动诊断状态刷新后再开始复测轮次。");
    return;
  }
  saveRetestRound({
    marker_id: markerId,
    started_at: new Date().toISOString(),
  });
  setLog(`复测轮次已准备：以当前 marker ${markerId} 为起点。采集花/跳后 watcher 会自动诊断。`);
  if (els.watchStatusNote) {
    els.watchStatusNote.textContent = `复测轮次已准备：以当前 marker ${markerId} 为起点；采集花/跳后等待 watcher 自动诊断。`;
  }
}

function scheduleWatchRefreshAfterScore(data) {
  const word = data?.target_word || "";
  if (!["花", "跳"].includes(word) || !data?.request_id) return;
  for (const timer of state.watchRefreshTimers) {
    window.clearTimeout(timer);
  }
  state.watchRefreshTimers = [];
  if (els.watchStatusNote) {
    els.watchStatusNote.textContent = `样本 ${data.request_id} 已保存；watcher 每 20 秒检查一次，页面会在 2 分钟内自动刷新诊断状态。`;
  }
  state.watchRefreshTimers = WATCH_REFRESH_AFTER_SCORE_DELAYS_MS.map((delayMs) => (
    window.setTimeout(refreshWatchStatus, delayMs)
  ));
}

function cameraAccessHint(err) {
  const name = err?.name || "UnknownError";
  const message = err?.message || String(err || "");
  const secure = window.isSecureContext ? "secure" : "not-secure";
  const origin = window.location.origin;
  const hints = {
    NotAllowedError: "浏览器权限被拒绝；请在地址栏左侧的网站设置里允许摄像头。",
    PermissionDeniedError: "浏览器权限被拒绝；请在地址栏左侧的网站设置里允许摄像头。",
    NotFoundError: "没有找到可用摄像头；请检查 Windows 摄像头设备和浏览器摄像头设置。",
    DevicesNotFoundError: "没有找到可用摄像头；请检查 Windows 摄像头设备和浏览器摄像头设置。",
    NotReadableError: "摄像头可能被微信、会议软件或系统相机占用；请关闭占用程序后重试。",
    TrackStartError: "摄像头可能被其他程序占用；请关闭占用程序后重试。",
    SecurityError: "当前页面不是浏览器允许摄像头的安全上下文；请通过 Windows 本机 http://127.0.0.1:5080 访问。",
    TypeError: "浏览器没有提供 mediaDevices；通常是因为没有通过 localhost/127.0.0.1 或 HTTPS 访问。",
  };
  const hint = hints[name] || "请确认使用 Windows 本机 http://127.0.0.1:5080、摄像头权限为允许，并关闭占用摄像头的程序。";
  return `${name}: ${message}。${hint} 当前地址：${origin}，上下文：${secure}`;
}

async function refreshStatus() {
  try {
    const resp = await fetch("/api/status");
    const data = await resp.json();
    const worker = data.worker || {};
    els.workerStatus.classList.remove("ready", "error");
    if (worker.status === "ready") {
      const init = worker.ready_payload?.holistic_init_sec;
      els.workerStatus.textContent = init ? `后端已就绪 · init ${init}s` : "后端已就绪";
      els.workerStatus.classList.add("ready");
      els.recordBtn.disabled = !state.stream || state.busy;
    } else if (worker.status === "error") {
      els.workerStatus.textContent = "后端错误";
      els.workerStatus.classList.add("error");
      els.recordBtn.disabled = true;
    } else {
      els.workerStatus.textContent = "Holistic 初始化中";
      els.recordBtn.disabled = true;
    }
    if (!state.templates.length && Array.isArray(data.templates)) {
      populateTemplates(data.templates);
    } else if (state.templates.length) {
      updateReferenceVideo();
    }
  } catch (err) {
    els.workerStatus.textContent = "无法连接后端";
    els.workerStatus.classList.add("error");
    els.recordBtn.disabled = true;
  }
}

async function refreshWatchStatus() {
  if (!els.watchStatusEvent) return;
  try {
    let data = null;
    try {
      const apiResp = await fetch("/api/watch-status", { cache: "no-store" });
      if (apiResp.ok) {
        const apiData = await apiResp.json();
        if (!apiData.error) {
          data = apiData;
        }
      }
    } catch (err) {
      data = null;
    }
    if (!data) {
      const staticResp = await fetch("/static/watch_status.json", { cache: "no-store" });
      if (!staticResp.ok) {
        throw new Error(`HTTP ${staticResp.status}`);
      }
      data = await staticResp.json();
    }
    const payload = data.payload || data || {};
    state.lastWatchPayload = payload;
    const status = payload.status || {};
    const targetSummary = status.target_summary || {};
    const targetIds = status.target_request_ids || [];
    const latest = payload.latest_diagnosis || {};
    const readiness = payload.goal_readiness || {};
    const frontendContract = payload.frontend_contract_check || null;
    const event = payload.event || (data.exists ? "unknown" : "missing");
    const targetCount = Number(targetSummary.count || 0);
    const heartbeatAt = Date.parse(payload.generated_at || "");
    const heartbeatAgeSec = Number.isFinite(heartbeatAt) ? Math.max(0, Math.round((Date.now() - heartbeatAt) / 1000)) : null;
    const stale = heartbeatAgeSec !== null && heartbeatAgeSec > 90;

    const labels = {
      no_target_samples: "无新增目标样本",
      diagnose_done: "已完成新增样本诊断",
      diagnose_failed: "新增样本诊断失败",
      diagnose_exception: "新增样本诊断异常",
      diagnose_retry_suppressed: "等待失败重试窗口",
      missing: "状态文件未生成",
      unknown: "状态未知",
    };
    const gateLabels = {
      backend_ready: "后端就绪",
      watcher_online: "watcher 在线",
      marker_available: "marker 可用",
      combined_quality_gate_passed: "综合质量门",
      fresh_real_webcam_target_samples_diagnosed: "真实花/跳复测",
    };
    const missingGates = Array.isArray(readiness.missing_gates) ? readiness.missing_gates : [];
    const missingText = missingGates.length
      ? missingGates.map((name) => gateLabels[name] || name).join("、")
      : (readiness.status_label ? "无" : "--");
    const browserEvidenceText = formatBrowserCaptureEvidence(readiness);
    const readinessSummaryText = formatReadinessSummary(readiness);
    const frontendContractText = formatFrontendContractCheck(frontendContract);

    const setWatchReportMeta = (hiddenWhenOnlyAudit = false) => {
      if (!els.watchReportMeta) return;
      const parts = [];
      if (latest.regression_report) parts.push(`回归 ${latest.regression_report}`);
      if (latest.semantic_diagnostics_report) parts.push(`语义 ${latest.semantic_diagnostics_report}`);
      if (latest.confusion_report) parts.push(`交叉 ${latest.confusion_report}`);
      if (latest.visual_report) parts.push(`骨架 ${latest.visual_report}`);
      if (readiness.md_path && !hiddenWhenOnlyAudit) parts.push(`完成度 ${readiness.md_path}`);
      if (frontendContract?.md_path) parts.push(`前端契约 ${frontendContract.md_path}`);
      els.watchReportMeta.hidden = !parts.length;
      if (parts.length) {
        renderWatchArtifactLinks(els.watchReportMeta, latest.static_artifacts || null, parts);
      }
    };

    els.watchStatusEvent.textContent = stale ? "监听状态可能过期" : labels[event] || event;
    els.watchTargetCount.textContent = `${targetCount}`;
    els.watchGeneratedAt.textContent = heartbeatAgeSec === null
      ? payload.generated_at || data.generated_at || "--"
      : `${payload.generated_at || "--"} · ${heartbeatAgeSec}s前`;
    if (els.watchGoalStatus) {
      els.watchGoalStatus.textContent = readiness.status_label || "--";
    }
    if (els.watchMissingGates) {
      els.watchMissingGates.textContent = missingText;
      els.watchMissingGates.title = [missingText, readinessSummaryText, browserEvidenceText].filter(Boolean).join("；");
    }
    renderWatchWordCoverage(readiness, Array.isArray(payload.words) ? payload.words : []);
    renderWatchNextRetestStep(readiness, Array.isArray(payload.words) ? payload.words : []);
    updateRetestRoundStatus();

    if (stale) {
      els.watchStatusNote.textContent = `自动诊断状态超过 ${heartbeatAgeSec}s 未刷新；请检查 watcher 进程或 tmux 会话。`;
      setWatchReportMeta();
    } else if (event === "diagnose_done" && latest.regression_report) {
      const sampleAdvice = formatWatchSampleSummaries(latest.semantic_sample_summaries);
      const confusionAdvice = formatWatchConfusionSummaries(latest.confusion_sample_summaries);
      const adviceParts = [sampleAdvice, confusionAdvice, readinessSummaryText, browserEvidenceText, frontendContractText].filter(Boolean);
      els.watchStatusNote.textContent = adviceParts.length
        ? `最近诊断 ${latest.diagnosed_request_ids?.join(", ") || "--"}；${adviceParts.join("；")}`
        : `最近诊断 ${latest.diagnosed_request_ids?.join(", ") || "--"}；回归、语义诊断、交叉混淆和骨架可视化已生成。`;
      setWatchReportMeta();
    } else if (targetCount > 0) {
      const suffix = [readinessSummaryText, browserEvidenceText, frontendContractText].filter(Boolean).map((item) => `；${item}`).join("");
      els.watchStatusNote.textContent = `检测到新增目标样本：${targetIds.join(", ") || "--"}。watcher 将自动诊断${suffix}`;
      setWatchReportMeta();
    } else if (state.retestRound?.marker_id && status.marker_last_request_id === state.retestRound.marker_id) {
      const suffix = [readinessSummaryText, browserEvidenceText, frontendContractText].filter(Boolean).map((item) => `；${item}`).join("");
      els.watchStatusNote.textContent = `复测轮次已准备：以 marker ${state.retestRound.marker_id} 为起点；采集花/跳后 watcher 会自动诊断${suffix}`;
      setWatchReportMeta();
    } else {
      const evidence = [readinessSummaryText, browserEvidenceText, frontendContractText].filter(Boolean).map((item) => `；${item}`).join("");
      els.watchStatusNote.textContent = `marker 后暂无新增花/跳样本；正式 marker：${status.marker_last_request_id || "--"}；watcher PID：${payload.watcher_pid || "--"}${evidence}。`;
      setWatchReportMeta();
    }
  } catch (err) {
    els.watchStatusEvent.textContent = "读取失败";
    els.watchTargetCount.textContent = "--";
    els.watchGeneratedAt.textContent = "--";
    if (els.watchGoalStatus) els.watchGoalStatus.textContent = "--";
    if (els.watchMissingGates) els.watchMissingGates.textContent = "--";
    if (els.watchWordCoverage) {
      els.watchWordCoverage.innerHTML = "";
      els.watchWordCoverage.hidden = true;
    }
    if (els.watchNextStep) {
      els.watchNextStep.textContent = "";
      els.watchNextStep.hidden = true;
    }
    updateRetestRoundStatus();
    els.watchStatusNote.textContent = `自动诊断状态读取失败：${err.message || err}`;
    if (els.watchReportMeta) {
      els.watchReportMeta.hidden = true;
    }
  }
}

function populateTemplates(templates) {
  state.templates = templates;
  els.targetWord.innerHTML = "";
  for (const item of templates) {
    const option = document.createElement("option");
    option.value = item.word;
    option.textContent = `${item.label} (${item.records ?? "?"}帧)`;
    if (item.word === "花") option.selected = true;
    els.targetWord.appendChild(option);
  }
  updateReferenceVideo();
}

function updateReferenceVideo() {
  const word = els.targetWord.value;
  const item = state.templates.find((row) => row.word === word);
  els.referenceLabel.textContent = word || "--";
  updateTargetCue(word, item);
  if (!state.referenceVisible || !item?.reference_video_url) {
    els.referenceVideo.removeAttribute("src");
    els.referenceVideo.load();
    return;
  }
  const nextSrc = item.reference_video_url;
  if (!els.referenceVideo.src.endsWith(encodeURI(nextSrc))) {
    els.referenceVideo.src = nextSrc;
    els.referenceVideo.load();
  }
}

function updateTargetCue(word, item) {
  if (!els.targetCue) return;
  const text = TARGET_CUES[word] || item?.semantic_profile?.description || "请保持核心动作、双手和关键手形完整入画。";
  const strong = els.targetCue.querySelector("strong");
  if (strong) {
    strong.textContent = text;
  }
  updateCaptureHint();
}

function setReferenceVisible(visible) {
  state.referenceVisible = Boolean(visible);
  els.mediaRow.classList.toggle("reference-hidden", !state.referenceVisible);
  els.referenceToggle.textContent = state.referenceVisible ? "隐藏参考" : "查看参考";
  els.referenceToggle.setAttribute("aria-expanded", state.referenceVisible ? "true" : "false");
  updateReferenceVideo();
}

async function openCamera() {
  try {
    if (state.stream) {
      closeCamera({ silent: true });
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new TypeError("navigator.mediaDevices.getUserMedia is unavailable");
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });
    els.preview.srcObject = state.stream;
    await els.preview.play();
    els.cameraStatus.textContent = "摄像头已开启";
    els.cameraBtn.textContent = "关闭摄像头";
    setLog("摄像头已开启。保持身体、双手和肩肘完整入画后采集。");
    for (const track of state.stream.getTracks()) {
      track.addEventListener("ended", () => closeCamera({ silent: true }), { once: true });
    }
    await refreshStatus();
  } catch (err) {
    els.cameraStatus.textContent = "摄像头开启失败";
    setLog(`摄像头权限失败：${cameraAccessHint(err)}`);
  }
}

function closeCamera({ silent = false } = {}) {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }
  state.stream = null;
  els.preview.srcObject = null;
  els.countdownOverlay.classList.add("hidden");
  els.cameraStatus.textContent = "摄像头未开启";
  els.cameraBtn.textContent = "开启摄像头";
  els.recordBtn.disabled = true;
  if (!silent) {
    setLog("摄像头已关闭。需要测评时可再次开启。");
  }
}

async function toggleCamera() {
  if (state.busy) {
    setLog("正在采集或打分，暂不关闭摄像头。");
    return;
  }
  if (state.stream) {
    closeCamera();
    return;
  }
  await openCamera();
}

function buildMotionSignature(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height).data;
  const bins = new Float32Array(MOTION_SIG_WIDTH * MOTION_SIG_HEIGHT);
  const counts = new Uint16Array(MOTION_SIG_WIDTH * MOTION_SIG_HEIGHT);
  for (let y = 0; y < height; y += 2) {
    const by = Math.min(MOTION_SIG_HEIGHT - 1, Math.floor((y / height) * MOTION_SIG_HEIGHT));
    for (let x = 0; x < width; x += 2) {
      const bx = Math.min(MOTION_SIG_WIDTH - 1, Math.floor((x / width) * MOTION_SIG_WIDTH));
      const src = (y * width + x) * 4;
      const gray = 0.299 * image[src] + 0.587 * image[src + 1] + 0.114 * image[src + 2];
      const dst = by * MOTION_SIG_WIDTH + bx;
      bins[dst] += gray / 255;
      counts[dst] += 1;
    }
  }
  for (let i = 0; i < bins.length; i += 1) {
    bins[i] = counts[i] ? bins[i] / counts[i] : 0;
  }
  return bins;
}

function signatureMotion(prev, curr) {
  if (!prev || !curr || prev.length !== curr.length) return 0;
  let total = 0;
  for (let i = 0; i < curr.length; i += 1) {
    total += Math.abs(curr[i] - prev[i]);
  }
  return total / curr.length;
}

function normalizeFrameWeights(values) {
  if (!values.length) return [];
  const positive = values.filter((value) => Number.isFinite(value) && value > 0);
  const baseline = positive.length ? positive.reduce((sum, value) => sum + value, 0) / positive.length : 1;
  const withFloor = values.map((value) => Math.max(0, Number(value) || 0) + baseline * 0.2);
  const mean = withFloor.reduce((sum, value) => sum + value, 0) / withFloor.length || 1;
  const clipped = withFloor.map((value) => Math.max(0.45, Math.min(2.75, value / mean)));
  const clippedMean = clipped.reduce((sum, value) => sum + value, 0) / clipped.length || 1;
  return clipped.map((value) => Number((value / clippedMean).toFixed(4)));
}

function selectEnergyCoverageFrames(candidates, targetFrames) {
  const count = candidates.length;
  const target = Math.max(1, Math.min(targetFrames, count));
  if (target >= count) {
    return candidates.map((item, idx) => ({ ...item, uploadWeight: item.frameWeight, uploadRank: idx }));
  }

  const selected = new Set();
  const coverageRatio = Math.max(0.45, Math.min(1.0, 0.25 + target / 32));
  const coverageCount = Math.max(2, Math.min(target, Math.ceil(target * coverageRatio)));
  for (let i = 0; i < coverageCount; i += 1) {
    const idx = Math.round((i * (count - 1)) / Math.max(coverageCount - 1, 1));
    selected.add(idx);
  }

  const ranked = candidates
    .map((item, idx) => ({ idx, score: item.energySmooth }))
    .sort((a, b) => b.score - a.score);
  for (const item of ranked) {
    if (selected.size >= target) break;
    selected.add(item.idx);
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .map((idx, rank) => ({ ...candidates[idx], uploadWeight: candidates[idx].frameWeight, uploadRank: rank }));
}

function clampNumber(value, minValue, maxValue, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minValue, Math.min(maxValue, number));
}

function getCaptureRecommendation(word) {
  return CAPTURE_RECOMMENDATIONS[word] || CAPTURE_RECOMMENDATIONS.default;
}

function formatDurationInput(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildCapturePlan({ write = false } = {}) {
  const word = els.targetWord.value;
  const rec = getCaptureRecommendation(word);
  let durationSec = clampNumber(els.durationSec.value, 1, 8, 3);
  let uploadFps = Math.round(clampNumber(els.captureFps.value, 1, 12, 5));
  const frameWidth = Math.round(clampNumber(els.frameWidth.value, 240, 960, 960));
  const requestedDurationSec = durationSec;
  const requestedUploadFps = uploadFps;
  const originalFrames = Math.max(1, Math.round(durationSec * uploadFps));
  let adjusted = false;

  if (durationSec < rec.minDurationSec) {
    durationSec = rec.minDurationSec;
    adjusted = true;
  }
  if (uploadFps < rec.minFps) {
    uploadFps = rec.minFps;
    adjusted = true;
  }
  if (Math.round(durationSec * uploadFps) < rec.minFrames) {
    uploadFps = Math.max(uploadFps, Math.ceil(rec.minFrames / durationSec));
    if (uploadFps > 12) {
      uploadFps = 12;
      durationSec = Math.min(8, Math.ceil((rec.minFrames / uploadFps) * 2) / 2);
    }
    adjusted = true;
  }

  const targetFrames = Math.max(rec.minFrames, Math.min(90, Math.round(durationSec * uploadFps)));
  const candidateFps = Math.max(uploadFps, Math.min(18, uploadFps * 2));
  const candidateFrames = Math.max(targetFrames, Math.round(durationSec * candidateFps));
  if (write) {
    els.durationSec.value = formatDurationInput(durationSec);
    els.captureFps.value = String(uploadFps);
    els.frameWidth.value = String(frameWidth);
  }
  return {
    word,
    requestedDurationSec,
    requestedUploadFps,
    durationSec,
    uploadFps,
    frameWidth,
    targetFrames,
    candidateFps,
    candidateFrames,
    minFrames: rec.minFrames,
    originalFrames,
    adjusted,
  };
}

function updateCaptureHint(plan = buildCapturePlan()) {
  if (!els.captureHint) return;
  if (plan.adjusted) {
    els.captureHint.textContent = `采样：${plan.word || "--"} 推荐 >=${plan.minFrames} 上传帧；当前设置 ${plan.requestedDurationSec}s x ${plan.requestedUploadFps}fps = ${plan.originalFrames} 帧，采集时将自动调整为 ${plan.durationSec}s x ${plan.uploadFps}fps = ${plan.targetFrames} 帧。`;
  } else {
    els.captureHint.textContent = `采样：${plan.word || "--"} 推荐 >=${plan.minFrames} 上传帧；当前 ${plan.durationSec}s x ${plan.uploadFps}fps = ${plan.targetFrames} 帧，采样满足推荐。`;
  }
}

function captureOneFrame(frameWidth) {
  const video = els.preview;
  const srcWidth = video.videoWidth || 640;
  const srcHeight = video.videoHeight || 480;
  const width = Math.max(240, Math.min(frameWidth, 960));
  const height = Math.round(width * (srcHeight / srcWidth));
  const canvas = els.canvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  const signature = buildMotionSignature(ctx, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return {
    frame: {
      image_format: "jpg",
      image_b64: dataUrl.split(",", 2)[1],
    },
    signature,
  };
}

async function recordFrames() {
  if (!state.stream || state.busy) return;
  state.busy = true;
  els.recordBtn.disabled = true;
  els.progressBar.style.width = "0%";
  els.progressBar.style.opacity = "1";
  setScorePending();

  const capturePlan = buildCapturePlan({ write: true });
  updateCaptureHint(capturePlan);
  const {
    durationSec,
    frameWidth,
    targetFrames,
    candidateFps,
    candidateFrames,
    adjusted,
    originalFrames,
    minFrames,
  } = capturePlan;
  const intervalMs = 1000 / candidateFps;
  const candidates = [];

  try {
    await runCountdown(3);
  } catch (err) {
    state.busy = false;
    await refreshStatus();
    return;
  }

  const adjustedText = adjusted ? `已从 ${originalFrames} 帧自动调整到推荐不少于 ${minFrames} 帧。` : "";
  setLog(`正在高频采集 ${durationSec}s，候选 ${candidateFrames} 帧，上传目标 ${targetFrames} 帧。${adjustedText}`);
  let prevSignature = null;
  for (let i = 0; i < candidateFrames; i += 1) {
    const captured = captureOneFrame(frameWidth);
    const motion = signatureMotion(prevSignature, captured.signature);
    prevSignature = captured.signature;
    candidates.push({
      candidateIndex: i,
      frame: captured.frame,
      energy: motion,
      energySmooth: motion,
      frameWeight: 1.0,
    });
    els.progressBar.style.width = `${Math.round(((i + 1) / candidateFrames) * 100)}%`;
    if (i + 1 < candidateFrames) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const energies = candidates.map((item, idx) => {
    const left = candidates[Math.max(0, idx - 1)].energy;
    const mid = item.energy;
    const right = candidates[Math.min(candidates.length - 1, idx + 1)].energy;
    return 0.25 * left + 0.5 * mid + 0.25 * right;
  });
  const weights = normalizeFrameWeights(energies);
  for (let i = 0; i < candidates.length; i += 1) {
    candidates[i].energySmooth = energies[i];
    candidates[i].frameWeight = weights[i] || 1.0;
  }

  const selected = selectEnergyCoverageFrames(candidates, targetFrames);
  const frames = selected.map((item) => item.frame);
  const frameIndices = selected.map((item) => item.candidateIndex);
  const frameWeights = selected.map((item) => item.uploadWeight);

  const peakWeight = frameWeights.length ? Math.max(...frameWeights) : 1;
  setLog(`候选 ${candidates.length} 帧中选取 ${frames.length} 帧，峰值权重 ${formatNumber(peakWeight, 2)}，正在发送到远端 Holistic 后端...`);
  els.progressBar.style.width = "0%";
  els.progressBar.style.opacity = "0.35";
  try {
    const resp = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_word: els.targetWord.value,
        fps: candidateFps,
        duration_sec: durationSec,
        frame_indices: frameIndices,
        frame_weights: frameWeights,
        client_source: "browser_camera",
        client_session_id: ensureClientSessionId(),
        client_capture_id: `capture_${Date.now()}`,
        frames,
        wait_for_ready_sec: 600,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.detail || `HTTP ${resp.status}`);
    }
    renderResult(data);
    scheduleWatchRefreshAfterScore(data);
    els.progressBar.style.width = "0%";
    els.progressBar.style.opacity = "1";
    setLog(`打分完成。样本 ID：${data.request_id || "--"}；结果目录：${data.artifacts?.result_dir || "--"}`);
  } catch (err) {
    setLog(`打分失败：${err.message || err}`);
    els.resultTitle.textContent = "打分失败";
    els.resultNote.textContent = "查看后端日志或确认 Holistic worker 已就绪。";
  } finally {
    state.busy = false;
    els.progressBar.style.opacity = "1";
    await refreshStatus();
  }
}

async function runCountdown(seconds) {
  const total = Math.max(1, Number(seconds) || 3);
  els.countdownOverlay.classList.remove("hidden");
  for (let remaining = total; remaining >= 1; remaining -= 1) {
    els.countdownValue.textContent = String(remaining);
    setLog(`${remaining}s 后开始采集，请准备动作。`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  els.countdownValue.textContent = "开始";
  setLog("开始采集。");
  await new Promise((resolve) => setTimeout(resolve, 260));
  els.countdownOverlay.classList.add("hidden");
}

function setScorePending() {
  state.lastRequestId = "";
  els.scoreValue.textContent = "--";
  els.scoreRing.style.background = "conic-gradient(var(--accent) 0deg, #e6ebf1 0deg)";
  els.resultTitle.textContent = "处理中";
  els.resultNote.textContent = "正在采集、识别并与目标模板做 DTW 对齐。";
  els.dtwDistance.textContent = "--";
  els.normDistance.textContent = "--";
  els.workerTime.textContent = "--";
  els.frameCount.textContent = "--";
  if (els.requestMeta) {
    els.requestMeta.hidden = true;
  }
  if (els.requestId) {
    els.requestId.textContent = "--";
  }
}

async function copyRequestId() {
  if (!state.lastRequestId) return;
  try {
    await navigator.clipboard.writeText(state.lastRequestId);
    setLog(`已复制样本 ID：${state.lastRequestId}`);
  } catch (err) {
    const input = document.createElement("textarea");
    input.value = state.lastRequestId;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand("copy");
      setLog(`已复制样本 ID：${state.lastRequestId}`);
    } catch (fallbackErr) {
      setLog(`样本 ID：${state.lastRequestId}`);
    } finally {
      input.remove();
    }
  }
}

function renderTable(tbody, entries) {
  tbody.innerHTML = "";
  for (const [key, value] of entries) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const val = document.createElement("td");
    name.textContent = key;
    val.textContent = value === null || value === undefined ? "--" : typeof value === "number" ? formatNumber(value, 6) : String(value);
    tr.appendChild(name);
    tr.appendChild(val);
    tbody.appendChild(tr);
  }
}

function semanticReasonLabel(reason) {
  const labels = {
    insufficient_two_hand_presence: "双手覆盖不足",
    required_presence_penalty_too_high: "必要手部覆盖不足",
    right_hand_geometry_too_far: "右手手形差异较大",
    relation_direction_mismatch: "双手相对运动方向不一致",
    weak_same_direction_vertical_jump: "纵向跳跃动作偏弱",
    relation_jump_amplitude_too_small: "跳跃幅度偏小",
    relation_motion_too_horizontal: "动作横向漂移过多",
    missing_relation_delta: "双手关系变化不可计算",
    weak_relation_delta: "双手关系变化过弱",
    flower_jump_like_two_hand_confusion: "更像双手交互动作",
    jump_like_two_hand_relation_with_weak_flower_opening: "跳样双手关系且开花动态弱",
    cross_word_confusion_risk: "目标词与相邻词区分不足",
    cross_check_error: "交叉检查失败",
    phase_order_disorder: "动作相位顺序不一致",
    semantic_phase_order_guard: "相位顺序守卫",
    used: "核心语义已匹配",
    passed: "通过",
    not_reported: "--",
  };
  return labels[reason] || reason || "--";
}

function semanticFloorSourceLabel(source) {
  const labels = {
    action_window_net: "动作窗口净位移",
    full_sequence_local_relation_segment: "完整序列局部弹跳段",
    short_visible_core: "短视频可见核心段",
  };
  return labels[source] || source || "--";
}

function captureQualityLabel(status) {
  const labels = {
    score_valid: "可评分",
    needs_recapture: "建议重采",
    semantic_mismatch: "动作语义不足",
  };
  return labels[status] || status || "--";
}

function buildCaptureAdvice(data, score) {
  const target = data.target_word || "";
  const scoreScale = data.score?.score_scale || {};
  const quality = scoreScale.capture_quality || data.score?.capture_quality || {};
  const floor = scoreScale.semantic_floor || {};
  const penalty = data.score?.sequence_penalty || {};
  const left = Number(penalty.query_presence?.left_hand ?? 0);
  const right = Number(penalty.query_presence?.right_hand ?? 0);
  const coreFull = Number(scoreScale.semantic_core_query_hand_presence_full ?? scoreScale.semantic_core_query_hand_presence ?? 0);
  const coreWindow = Number(scoreScale.semantic_core_query_hand_presence_window ?? scoreScale.semantic_core_query_hand_presence ?? 0);
  const flowerGuard = scoreScale.flower_opening_guard || {};
  const flowerJumpGuard = scoreScale.flower_jump_confusion_guard || {};
  const phaseOrderGuard = scoreScale.semantic_phase_order_guard || {};
  const reason = quality.reason || floor.reason || "";

  if (phaseOrderGuard.blocked || reason === "phase_order_disorder" || scoreScale.reason === "semantic_phase_order_guard") {
    if (target === "花") {
      return "请按“撮合到张开”的顺序完整完成，不要先张开再合拢、倒放动作或跳过中段；动作顺序清楚后再重采。";
    }
    if (target === "跳") {
      return "请保持左手先稳定作为“地面”，右手两指再从下向上弹跳，不要先做结束姿态或倒放动作；顺序清楚后再重采。";
    }
    return "请按参考动作从起始姿态到结束姿态完整完成，不要倒放、跳过中段或先做结束再做开始；动作顺序清楚后再重采。";
  }

  if (target === "花") {
    if (flowerJumpGuard.blocked || reason === "flower_jump_like_two_hand_confusion") {
      return "当前检测到稳定双手关系和较弱开花动态，更像“跳”等双手交互动作；做“花”时请只保留一只开花手，从撮合到张开。";
    }
    if (reason === "flower_core_hand_presence_low" || coreWindow < 0.58) {
      return `让开花手保持在画面中央，完整露出手腕和五指；当前窗口核心手覆盖 ${formatNumber(coreWindow, 2)}。`;
    }
    if (reason === "flower_opening_guard_failed" || reason === "opening_guard_too_weak" || (flowerGuard.enabled && flowerGuard.best_score < 0.6)) {
      return `从撮合状态开始，慢慢张开五指并保持 0.5s；当前张开分数 ${formatNumber(flowerGuard.best_score, 2)}。`;
    }
    if (score < 75) {
      return `保持手部靠近摄像头、动作完整覆盖撮合到张开；全段覆盖 ${formatNumber(coreFull, 2)}、窗口覆盖 ${formatNumber(coreWindow, 2)}。`;
    }
    return "当前开花核心段可评分；继续保持手部完整入画和清晰张开动态。";
  }

  if (target === "跳") {
    if (reason === "jump_two_hand_presence_low" || floor.reason === "insufficient_two_hand_presence") {
      return `左手“地面”和右手“两指小人”需要同时入画；当前左手覆盖 ${formatNumber(left, 2)}、右手覆盖 ${formatNumber(right, 2)}。`;
    }
    if (floor.reason === "relation_direction_mismatch") {
      return "右手两指需要在左手上方向上弹起，避免只做横向摆动或单手移动。";
    }
    if (floor.reason === "relation_jump_amplitude_too_small" || floor.reason === "weak_same_direction_vertical_jump") {
      return "右手两指弹跳幅度偏小；请先弯曲再向上弹起，动作稍微明显一些。";
    }
    if (score < 75) {
      return `保持双手关系清楚：左手稳定作为地面，右手食指/中指完成弹跳；当前左/右覆盖 ${formatNumber(left, 2)}/${formatNumber(right, 2)}。`;
    }
    return "当前双手弹跳核心语义可评分；继续保持两只手同时稳定入画。";
  }

  if (quality.status === "needs_recapture") {
    return quality.message || "核心手部覆盖不足，请让关键手部完整入画后重采。";
  }
  return "查看参考动作，保持关键手形、移动方向和动作起止完整入画。";
}

function buildDiagnosticNote(data, score) {
  const target = data.target_word || "";
  const scoreScale = data.score?.score_scale || {};
  const quality = scoreScale.capture_quality || data.score?.capture_quality || {};
  const advice = buildCaptureAdvice(data, score);
  const phaseOrderGuard = scoreScale.semantic_phase_order_guard || {};
  if (phaseOrderGuard.blocked) {
    return `语义诊断：${semanticReasonLabel(phaseOrderGuard.reason || "phase_order_disorder")}。检测到关键动作相位出现大跨度反序；乱序指标 ${formatNumber(phaseOrderGuard.disorder_span_score, 3)}，相邻乱序 ${formatNumber(phaseOrderGuard.adjacent_disorder_span_score, 3)}。${advice}`;
  }
  if (quality.status === "needs_recapture") {
    return `采集质量：${captureQualityLabel(quality.status)}。${quality.message || "核心关键点覆盖不足，建议重采后再评分。"} ${advice}`;
  }
  if (quality.status === "semantic_mismatch" && quality.message) {
    return `语义诊断：${semanticReasonLabel(quality.reason)}。${quality.message} ${advice}`;
  }

  const floor = scoreScale.semantic_floor || {};
  const penalty = data.score?.sequence_penalty || {};
  const left = Number(penalty.query_presence?.left_hand ?? 0);
  const right = Number(penalty.query_presence?.right_hand ?? 0);
  const floorReason = floor.reason || (floor.used ? "used" : "");
  const flowerGuard = scoreScale.flower_opening_guard || {};

  if (target === "跳" && score >= 60 && floor.source === "full_sequence_local_relation_segment") {
    const shapeMean = floor.right_two_finger_shape?.mean;
    const coverage = floor.query_segment_coverage;
    return `语义诊断：检测到完整序列中的局部双手弹跳段；两指手形 ${formatNumber(shapeMean, 2)}，局部段覆盖 ${formatNumber(coverage, 2)}。该分数仍是 demo 模板原型相似度。`;
  }

  if (target === "花" && score >= 60 && floor.source === "short_visible_core") {
    return `语义诊断：短视频中检测到开花核心段；张开分数 ${formatNumber(floor.opening_score, 2)}，核心手覆盖 ${formatNumber(floor.core_presence, 2)}。该分数仍是 demo 模板原型相似度。`;
  }

  if (target === "跳" && score < 60) {
    if (floorReason === "insufficient_two_hand_presence") {
      return `低分诊断：${semanticReasonLabel(floorReason)}。当前左手覆盖 ${formatNumber(left, 2)}、右手覆盖 ${formatNumber(right, 2)}；请让左手“地面”和右手“跳跃”同时稳定入画。`;
    }
    if (floorReason === "relation_direction_mismatch") {
      return "低分诊断：双手相对运动方向不一致。当前没有检测到右手在左手基础上完成同方向的纵向弹跳。";
    }
    if (floorReason) {
      return `低分诊断：${semanticReasonLabel(floorReason)}。`;
    }
  }

  if (target === "花" && flowerGuard.enabled && flowerGuard.passed === false) {
    return `低分诊断：未检测到清晰的手指张开/绽放动态；当前手部局部形状可能相似，但 opening/spread 语义不足。${advice}`;
  }

  if (score >= 75) {
    return "当前核心语义匹配较好；该分数仍只用于 demo 模板原型相似度检查。";
  }
  if (score >= 60) {
    return "当前核心语义部分匹配，但仍存在动作幅度、时序或手部覆盖差异；该分数不是正式合格线。";
  }
  return `当前分数较低，建议查看下方语义诊断和手部覆盖字段；该分数不是正式用户评分。${advice}`;
}

function renderResult(data) {
  const score = data.score?.prototype_score ?? 0;
  const clamped = Math.max(0, Math.min(100, score));
  const degrees = (clamped / 100) * 360;
  const scoreScale = data.score?.score_scale || {};
  const quality = scoreScale.capture_quality || data.score?.capture_quality || {};
  const ringColor = quality.status === "needs_recapture" ? "var(--warn)" : quality.status === "semantic_mismatch" ? "var(--bad)" : "var(--accent)";
  els.scoreValue.textContent = formatNumber(score, 1);
  els.scoreRing.style.background = `conic-gradient(${ringColor} ${degrees}deg, #e6ebf1 ${degrees}deg)`;
  els.resultTitle.textContent = `${data.target_word} · ${quality.status ? captureQualityLabel(quality.status) : "原型相似度"}`;
  els.resultNote.textContent = buildDiagnosticNote(data, score);
  state.lastRequestId = data.request_id || "";
  if (els.requestMeta) {
    els.requestMeta.hidden = !state.lastRequestId;
  }
  if (els.requestId) {
    els.requestId.textContent = state.lastRequestId || "--";
  }
  els.dtwDistance.textContent = formatNumber(data.score?.dtw_distance, 5);
  els.normDistance.textContent = formatNumber(data.score?.normalized_distance, 5);
  els.workerTime.textContent = `${formatNumber(data.worker?.holistic_eval_sec, 3)}s`;
  els.frameCount.textContent = String(data.frame_count ?? "--");

  const groupEntries = Object.entries(data.score?.group_mean_distance || {});
  renderTable(els.groupMetrics, groupEntries.length ? groupEntries : [["暂无结果", "--"]]);

  const p = data.score?.sequence_penalty || {};
  renderTable(els.penaltyMetrics, [
    ["total_sequence_penalty", p.total_sequence_penalty],
    ["length_ratio", p.length_ratio],
    ["length_penalty", p.length_penalty],
    ["presence_penalty", p.presence_penalty],
    ["motion_penalty", p.motion_penalty],
    ["roughness_penalty", p.roughness_penalty],
    ["info_penalty", p.info_penalty],
    ["endpoint_penalty", p.endpoint_penalty],
  ]);

  const semanticFloor = scoreScale.semantic_floor || {};
  const flowerGuard = scoreScale.flower_opening_guard || {};
  const flowerJumpGuard = scoreScale.flower_jump_confusion_guard || {};
  const phaseOrderGuard = scoreScale.semantic_phase_order_guard || {};
  const crossWordCheck = data.score?.cross_word_check || scoreScale.cross_word_check || {};
  const guardBest = flowerGuard.best || {};
  const flowerJumpShape = flowerJumpGuard.right_two_finger_shape || {};
  const twoFingerShape = semanticFloor.right_two_finger_shape || {};
  const crossTargetScore = crossWordCheck.target_score ?? crossWordCheck.target_score_summary?.prototype_score;
  const crossOtherScore = crossWordCheck.other_score ?? crossWordCheck.other_score_summary?.prototype_score;
  const crossOtherReason = crossWordCheck.other_score_summary?.score_scale_reason || crossWordCheck.reason;
  const segmentRange = semanticFloor.query_segment_start_frame_idx !== undefined || semanticFloor.query_segment_end_frame_idx !== undefined
    ? `${semanticFloor.query_segment_start_frame_idx ?? "--"}-${semanticFloor.query_segment_end_frame_idx ?? "--"}`
    : "--";
  const fallbackFrom = semanticFloor.fallback_from || {};
  const phaseOrderIndices = Array.isArray(phaseOrderGuard.best_query_indices)
    ? phaseOrderGuard.best_query_indices.join("→")
    : "--";
  const phaseOrderTriggers = Array.isArray(phaseOrderGuard.triggered_by)
    ? phaseOrderGuard.triggered_by.join(", ")
    : "--";
  renderTable(els.diagnosticMetrics, [
    ["样本 ID", data.request_id],
    ["采集建议", buildCaptureAdvice(data, score)],
    ["采集状态", captureQualityLabel(quality.status)],
    ["采集诊断", quality.reason],
    ["评分可靠", quality.reliable_for_scoring],
    ["对齐策略", data.score?.alignment_policy?.mode],
    ["分数尺度原因", scoreScale.reason],
    ["语义 floor 原因", semanticReasonLabel(semanticFloor.reason || (semanticFloor.used ? "used" : "--"))],
    ["语义 floor 来源", semanticFloorSourceLabel(semanticFloor.source)],
    ["语义 floor 分数", scoreScale.semantic_floor_score],
    ["跳-局部段帧", segmentRange],
    ["跳-局部段覆盖", semanticFloor.query_segment_coverage],
    ["跳-两指手形", twoFingerShape.mean],
    ["跳-fallback 原因", semanticReasonLabel(fallbackFrom.reason)],
    ["核心手覆盖", scoreScale.semantic_core_query_hand_presence],
    ["核心手覆盖-全段", scoreScale.semantic_core_query_hand_presence_full],
    ["核心手覆盖-窗口", scoreScale.semantic_core_query_hand_presence_window],
    ["核心守卫通过", scoreScale.semantic_core_guard_passed],
    ["花-张开分数", flowerGuard.best_score],
    ["花-张开手", guardBest.group],
    ["花/跳交叉检查", crossWordCheck.enabled ? (crossWordCheck.passed ? "通过" : "需复查") : "--"],
    ["交叉词", crossWordCheck.other_word],
    ["交叉目标分", crossTargetScore],
    ["交叉对照分", crossOtherScore],
    ["交叉 margin", crossWordCheck.margin],
    ["交叉原因", semanticReasonLabel(crossOtherReason)],
    ["花-跳样守卫", flowerJumpGuard.blocked ? "阻断" : (flowerJumpGuard.enabled ? "未触发" : "--")],
    ["花-跳样原因", semanticReasonLabel(flowerJumpGuard.reason)],
    ["花-跳样双手覆盖", flowerJumpGuard.two_hand_presence],
    ["花-跳样两指手形", flowerJumpShape.mean ?? flowerJumpGuard.right_two_finger_shape_mean],
    ["相位顺序守卫", phaseOrderGuard.blocked ? "阻断" : (phaseOrderGuard.enabled ? "通过" : "--")],
    ["相位顺序原因", semanticReasonLabel(phaseOrderGuard.reason)],
    ["相位锚点帧", phaseOrderIndices],
    ["相位乱序指标", phaseOrderGuard.disorder_span_score],
    ["相邻乱序指标", phaseOrderGuard.adjacent_disorder_span_score],
    ["相位触发项", phaseOrderTriggers],
    ["左手覆盖", p.query_presence?.left_hand],
    ["右手覆盖", p.query_presence?.right_hand],
    ["必要覆盖惩罚", p.required_presence_penalty],
  ]);
}

els.cameraBtn.addEventListener("click", toggleCamera);
els.recordBtn.addEventListener("click", recordFrames);
els.copyRequestBtn?.addEventListener("click", copyRequestId);
els.prepareRetestBtn?.addEventListener("click", prepareRetestRound);
els.refreshWatchBtn?.addEventListener("click", () => {
  if (els.watchStatusNote) {
    els.watchStatusNote.textContent = "正在刷新自动诊断状态。";
  }
  refreshWatchStatus();
});
els.targetWord.addEventListener("change", () => {
  updateReferenceVideo();
  updateCaptureHint();
});
els.durationSec.addEventListener("input", () => updateCaptureHint());
els.captureFps.addEventListener("input", () => updateCaptureHint());
els.frameWidth.addEventListener("input", () => updateCaptureHint());
els.referenceToggle.addEventListener("click", () => setReferenceVisible(!state.referenceVisible));

setReferenceVisible(false);
updateCaptureHint();
updateRetestRoundStatus();
refreshStatus();
refreshWatchStatus();
setInterval(refreshStatus, 5000);
setInterval(refreshWatchStatus, 10000);
