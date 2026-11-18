import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateReferenceCost, getModelContextLimit, normalizeModelKey } from './pricing.mjs';

const ID_RE = /^[0-9a-f-]{8,64}$/i;

export function isValidConversationId(id) {
  return typeof id === 'string' && ID_RE.test(id.trim());
}

export function classifyError(status, message = '') {
  const s = String(status || '').toUpperCase();
  const m = String(message || '').toLowerCase();
  if (!m && (s === 'DONE' || s === 'CORTEX_STEP_STATUS_DONE' || s === 'CASCADE_RUN_STATUS_IDLE' || s === 'CASCADE_RUN_STATUS_RUNNING' || !s)) {
    return null;
  }
  if (m.includes('context') || m.includes('token limit') || m.includes('too long') || m.includes('exceeds the maximum')) {
    return { code: 'context_limit', label: '上下文超限', detail: message };
  }
  if (m.includes('429') || m.includes('quota') || m.includes('rate limit') || m.includes('resource_exhausted')) {
    return { code: 'rate_limit', label: '配额/限流', detail: message };
  }
  if (m.includes('econn') || m.includes('timeout') || m.includes('network') || m.includes('fetch failed') || m.includes('socket')) {
    return { code: 'network', label: '网络异常', detail: message };
  }
  if (m.includes('unauth') || m.includes('401') || m.includes('403') || m.includes('permission')) {
    return { code: 'auth', label: '鉴权/权限异常', detail: message };
  }
  if (s.includes('ERROR') || s.includes('FAILED') || m) {
    return { code: 'other', label: '请求异常', detail: message || s };
  }
  return null;
}

export function parseTranscriptJsonl(text) {
  const records = [];
  if (!text) return records;
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object') {
        records.push(obj);
      }
    } catch {
      // Ignore partial trailing line while writer is flushing
    }
  }
  return records;
}

function parseMs(iso) {
  if (!iso) return NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

function extractTextChars(val) {
  if (!val) return 0;
  if (typeof val === 'string') return val.length;
  try {
    return JSON.stringify(val).length;
  } catch {
    return 0;
  }
}

/**
 * Computes rich metrics for a single conversation by preferring live LanguageServer steps
 * (with exact model IDs & timestamps) and falling back cleanly to transcript.jsonl.
 */
export function computeConversationMetrics({
  conversationId,
  lsSteps = null,
  transcriptRecords = [],
  modelMap = {},
  budgetPref = 'auto',
  summaryMeta = null,
}) {
  const hasLs = Array.isArray(lsSteps) && lsSteps.length > 0;
  const plannerEntries = [];
  const breakdown = {
    userChars: 0,
    assistantChars: 0,
    thinkingChars: 0,
    toolChars: 0,
    totalSteps: 0,
    toolCalls: 0,
    errorCount: 0,
  };
  let lastError = null;
  let lastUserAtMs = NaN;

  if (hasLs) {
    breakdown.totalSteps = lsSteps.length;
    for (let i = 0; i < lsSteps.length; i++) {
      const st = lsSteps[i];
      const type = String(st?.type || '');
      const status = String(st?.status || '');
      const meta = st?.metadata || {};
      const createdMs = parseMs(meta.createdAt);

      if (type === 'CORTEX_STEP_TYPE_USER_INPUT') {
        breakdown.userChars += extractTextChars(st.userInput?.items || st.userInput);
        if (Number.isFinite(createdMs)) lastUserAtMs = createdMs;
        continue;
      }

      if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
        const pr = st.plannerResponse || {};
        const mu = meta.modelUsage || {};
        const inputTokens = Number(mu.inputTokens || 0);
        const cacheReadTokens = Number(mu.cacheReadTokens || 0);
        const outputTokens = Number(mu.outputTokens || 0);
        const thinkingTokens = Number(mu.thinkingOutputTokens || 0);
        const responseTokens = Number(mu.responseOutputTokens || 0);
        const toolCallsArr = Array.isArray(pr.toolCalls) ? pr.toolCalls : [];
        const toolCount = toolCallsArr.length;

        breakdown.assistantChars += extractTextChars(pr.response || pr.modifiedResponse);
        breakdown.thinkingChars += extractTextChars(pr.thinking);
        breakdown.toolChars += extractTextChars(toolCallsArr);
        breakdown.toolCalls += toolCount;

        const startedMs = parseMs(meta.startedAt);
        const viewableMs = parseMs(meta.viewableAt);
        const finishedMs = parseMs(meta.finishedGeneratingAt || meta.completedAt);

        const reqStartMs = Number.isFinite(createdMs) ? createdMs : startedMs;
        const ttftMs = Number.isFinite(reqStartMs) && Number.isFinite(viewableMs) && viewableMs >= reqStartMs
          ? viewableMs - reqStartMs
          : null;

        let genDurationMs = null;
        let tokensPerSec = null;
        let speedMode = 'step';

        if (Number.isFinite(viewableMs) && Number.isFinite(finishedMs) && finishedMs - viewableMs >= 800 && responseTokens > 0) {
          genDurationMs = finishedMs - viewableMs;
          tokensPerSec = Number((responseTokens / (genDurationMs / 1000)).toFixed(1));
          speedMode = 'stream';
        } else if (Number.isFinite(reqStartMs) && Number.isFinite(finishedMs) && finishedMs > reqStartMs && outputTokens > 0) {
          genDurationMs = finishedMs - reqStartMs;
          tokensPerSec = Number((outputTokens / (genDurationMs / 1000)).toFixed(1));
          speedMode = 'step';
        }

        const totalDurationMs = Number.isFinite(reqStartMs) && Number.isFinite(finishedMs) && finishedMs >= reqStartMs
          ? finishedMs - reqStartMs
          : null;

        const rawModel = mu.model || meta.generatorModel || '';
        const err = classifyError(status, st.error?.message || meta.error?.message || '');
        if (err) {
          breakdown.errorCount += 1;
          lastError = err;
        }

        if (inputTokens + cacheReadTokens + outputTokens > 0 || err) {
          const cost = calculateReferenceCost({ inputTokens, cacheReadTokens, outputTokens }, rawModel, modelMap);
          plannerEntries.push({
            stepIndex: i,
            createdAt: meta.createdAt || null,
            createdMs: reqStartMs,
            rawModel,
            modelLabel: cost.modelLabel,
            inputTokens,
            cacheReadTokens,
            outputTokens,
            thinkingTokens,
            responseTokens,
            contextUsed: inputTokens + cacheReadTokens,
            ttftMs,
            genDurationMs,
            totalDurationMs,
            tokensPerSec,
            speedMode,
            toolCalls: toolCount,
            status: status.replace('CORTEX_STEP_STATUS_', ''),
            error: err,
            costUSD: cost.totalCostUSD,
            costBreakdown: cost,
          });
        }
      } else {
        // Other tool execution / artifact steps
        breakdown.toolChars += extractTextChars(meta.toolCall) + extractTextChars(st.runCommand || st.viewFile || st.commandStatus);
        if (status.includes('ERROR')) {
          const err = classifyError(status, st.error?.message || '');
          if (err) {
            breakdown.errorCount += 1;
            lastError = err;
          }
        }
      }
    }
  }

  // Fallback or supplement from transcript.jsonl when LS steps are unavailable (archived/CLI)
  if (!hasLs && Array.isArray(transcriptRecords) && transcriptRecords.length > 0) {
    breakdown.totalSteps = transcriptRecords.length;
    let prevTsMs = NaN;
    for (const rec of transcriptRecords) {
      const type = String(rec.type || '');
      const status = String(rec.status || '');
      const createdMs = parseMs(rec.created_at);

      if (type === 'USER_INPUT') {
        breakdown.userChars += extractTextChars(rec.content);
        if (Number.isFinite(createdMs)) {
          lastUserAtMs = createdMs;
          prevTsMs = createdMs;
        }
        continue;
      }

      if (type === 'PLANNER_RESPONSE') {
        const inputTokens = Number(rec.input_tokens || 0);
        const cacheReadTokens = Number(rec.cache_read_tokens || 0);
        const outputTokens = Number(rec.output_tokens || 0);
        const toolCallsArr = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
        const toolCount = toolCallsArr.length;

        breakdown.assistantChars += extractTextChars(rec.content);
        breakdown.thinkingChars += extractTextChars(rec.thinking);
        breakdown.toolChars += extractTextChars(toolCallsArr);
        breakdown.toolCalls += toolCount;

        const stepDeltaMs = Number.isFinite(createdMs) && Number.isFinite(prevTsMs) && createdMs > prevTsMs && (createdMs - prevTsMs) < 600_000
          ? createdMs - prevTsMs
          : null;
        const tokensPerSec = stepDeltaMs && outputTokens > 0
          ? Number((outputTokens / (stepDeltaMs / 1000)).toFixed(1))
          : null;

        const err = classifyError(status, rec.error || '');
        if (err) {
          breakdown.errorCount += 1;
          lastError = err;
        }

        if (inputTokens + cacheReadTokens + outputTokens > 0 || err) {
          const cost = calculateReferenceCost({ inputTokens, cacheReadTokens, outputTokens }, '', modelMap);
          plannerEntries.push({
            stepIndex: Number(rec.step_index ?? plannerEntries.length),
            createdAt: rec.created_at || null,
            createdMs,
            rawModel: '',
            modelLabel: cost.modelLabel,
            inputTokens,
            cacheReadTokens,
            outputTokens,
            thinkingTokens: 0,
            responseTokens: outputTokens,
            contextUsed: inputTokens + cacheReadTokens,
            ttftMs: null,
            genDurationMs: stepDeltaMs,
            totalDurationMs: stepDeltaMs,
            tokensPerSec,
            speedMode: 'step',
            toolCalls: toolCount,
            status,
            error: err,
            costUSD: cost.totalCostUSD,
            costBreakdown: cost,
          });
        }
        if (Number.isFinite(createdMs)) prevTsMs = createdMs;
      } else {
        breakdown.toolChars += extractTextChars(rec.content);
        if (Number.isFinite(createdMs)) prevTsMs = createdMs;
      }
    }
  }

  // Aggregate session totals
  let totalInput = 0;
  let totalCache = 0;
  let totalOutput = 0;
  let totalThinking = 0;
  let totalResponse = 0;
  let totalCostUSD = 0;
  let totalInputCostUSD = 0;
  let totalCacheCostUSD = 0;
  let totalOutputCostUSD = 0;

  for (const p of plannerEntries) {
    totalInput += p.inputTokens;
    totalCache += p.cacheReadTokens;
    totalOutput += p.outputTokens;
    totalThinking += p.thinkingTokens;
    totalResponse += p.responseTokens;
    totalCostUSD += p.costUSD;
    totalInputCostUSD += p.costBreakdown.inputCostUSD;
    totalCacheCostUSD += p.costBreakdown.cacheCostUSD;
    totalOutputCostUSD += p.costBreakdown.outputCostUSD;
  }

  const latest = plannerEntries.length ? plannerEntries[plannerEntries.length - 1] : null;
  const activeRawModel = latest?.rawModel || '';
  const modelInfo = normalizeModelKey(activeRawModel, modelMap);
  const budgetInfo = getModelContextLimit(activeRawModel, modelMap, budgetPref);

  const latestContextUsed = latest ? latest.contextUsed : 0;
  const nextRoundBaseline = latest ? latest.contextUsed + latest.outputTokens : 0;
  const budgetLimit = budgetInfo.limit;
  const remaining = Math.max(0, budgetLimit - latestContextUsed);
  const percent = budgetLimit > 0 ? Number(((latestContextUsed / budgetLimit) * 100).toFixed(1)) : 0;

  let health = 'normal';
  if (lastError && plannerEntries.length && latest?.error) health = 'error';
  else if (percent >= 90) health = 'critical';
  else if (percent >= 75) health = 'warn';

  const latestPromptTotal = latest ? latest.inputTokens + latest.cacheReadTokens : 0;
  const latestCacheHitRate = latestPromptTotal > 0 ? Number(((latest.cacheReadTokens / latestPromptTotal) * 100).toFixed(1)) : 0;
  const sessionPromptTotal = totalInput + totalCache;
  const sessionCacheHitRate = sessionPromptTotal > 0 ? Number(((totalCache / sessionPromptTotal) * 100).toFixed(1)) : 0;

  // Heuristic char-to-token range for audit drawer (transparent non-exact estimate)
  const totalChars = breakdown.userChars + breakdown.assistantChars + breakdown.thinkingChars + breakdown.toolChars;

  return {
    conversationId,
    title: summaryMeta?.summary || null,
    runStatus: summaryMeta?.status || null,
    dataSource: hasLs ? 'language_server' : (transcriptRecords.length ? 'transcript_jsonl' : 'empty'),
    model: {
      raw: activeRawModel,
      key: modelInfo.key,
      label: modelInfo.label,
      isFallback: Boolean(modelInfo.isFallback),
    },
    budget: {
      used: latestContextUsed,
      nextBaseline: nextRoundBaseline,
      limit: budgetLimit,
      remaining,
      percent,
      limitSource: budgetInfo.source,
      health,
    },
    latestStep: latest ? {
      stepIndex: latest.stepIndex,
      createdAt: latest.createdAt,
      inputTokens: latest.inputTokens,
      cacheReadTokens: latest.cacheReadTokens,
      outputTokens: latest.outputTokens,
      thinkingTokens: latest.thinkingTokens,
      responseTokens: latest.responseTokens,
      cacheHitRate: latestCacheHitRate,
      ttftMs: latest.ttftMs,
      genDurationMs: latest.genDurationMs,
      totalDurationMs: latest.totalDurationMs,
      tokensPerSec: latest.tokensPerSec,
      speedMode: latest.speedMode,
      costUSD: latest.costUSD,
      status: latest.status,
      error: latest.error,
    } : null,
    sessionTotals: {
      inputTokens: totalInput,
      cacheReadTokens: totalCache,
      outputTokens: totalOutput,
      thinkingTokens: totalThinking,
      responseTokens: totalResponse,
      totalTokens: totalInput + totalCache + totalOutput,
      cacheHitRate: sessionCacheHitRate,
      plannerCount: plannerEntries.length,
      totalSteps: breakdown.totalSteps,
      toolCalls: breakdown.toolCalls,
      errorCount: breakdown.errorCount,
      lastError,
      costUSD: totalCostUSD,
      inputCostUSD: totalInputCostUSD,
      cacheCostUSD: totalCacheCostUSD,
      outputCostUSD: totalOutputCostUSD,
    },
    contentAudit: {
      totalChars,
      userChars: breakdown.userChars,
      assistantChars: breakdown.assistantChars,
      thinkingChars: breakdown.thinkingChars,
      toolChars: breakdown.toolChars,
    },
    timeline: plannerEntries.slice(-30).reverse().map((p) => ({
      stepIndex: p.stepIndex,
      createdAt: p.createdAt,
      modelLabel: p.modelLabel,
      inputTokens: p.inputTokens,
      cacheReadTokens: p.cacheReadTokens,
      outputTokens: p.outputTokens,
      thinkingTokens: p.thinkingTokens,
      responseTokens: p.responseTokens,
      contextUsed: p.contextUsed,
      ttftMs: p.ttftMs,
      totalDurationMs: p.totalDurationMs,
      tokensPerSec: p.tokensPerSec,
      speedMode: p.speedMode,
      toolCalls: p.toolCalls,
      status: p.status,
      costUSD: p.costUSD,
    })),
  };
}

// File-level incremental cache: path -> { size, mtimeMs, summary }
const fileCache = new Map();

function localDateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function summarizeTranscriptFile(filePath, conversationId, source) {
  const st = statSync(filePath);
  const cached = fileCache.get(filePath);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return cached.summary;
  }

  const records = parseTranscriptJsonl(readFileSync(filePath, 'utf-8'));
  const daily = {}; // YYYY-MM-DD -> { input, cache, output, steps }
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let latestContextUsed = 0;
  let plannerSteps = 0;
  let latestTs = st.mtimeMs;

  for (const rec of records) {
    if (rec.type !== 'PLANNER_RESPONSE') continue;
    const inp = Number(rec.input_tokens || 0);
    const cache = Number(rec.cache_read_tokens || 0);
    const out = Number(rec.output_tokens || 0);
    if (inp + cache + out <= 0) continue;

    plannerSteps += 1;
    inputTokens += inp;
    cacheReadTokens += cache;
    outputTokens += out;
    latestContextUsed = inp + cache;

    const ms = parseMs(rec.created_at);
    const dayKey = localDateKey(Number.isFinite(ms) ? ms : st.mtimeMs);
    if (Number.isFinite(ms) && ms > latestTs) latestTs = ms;

    if (!daily[dayKey]) daily[dayKey] = { input: 0, cache: 0, output: 0, steps: 0 };
    daily[dayKey].input += inp;
    daily[dayKey].cache += cache;
    daily[dayKey].output += out;
    daily[dayKey].steps += 1;
  }

  const summary = {
    conversationId,
    source,
    updatedAtMs: latestTs,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens: inputTokens + cacheReadTokens + outputTokens,
    latestContextUsed,
    plannerSteps,
    daily,
  };

  if (fileCache.size > 1500) {
    const firstKey = fileCache.keys().next().value;
    if (firstKey) fileCache.delete(firstKey);
  }
  fileCache.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, summary });
  return summary;
}

function scanBrainDir(brainDir, source) {
  const results = [];
  if (!brainDir || !existsSync(brainDir)) return results;
  let entries;
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const convId = entry.name;
    const stdPath = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    const flatPath = join(brainDir, convId, 'transcript.jsonl');
    const target = existsSync(stdPath) ? stdPath : (existsSync(flatPath) ? flatPath : null);
    if (!target) continue;
    try {
      const s = summarizeTranscriptFile(target, convId, source);
      if (s.totalTokens > 0 || s.plannerSteps > 0) results.push(s);
    } catch {
      // Ignore unreadable individual transcript
    }
  }
  return results;
}

function addDayTotals(target, src) {
  target.input += src.input;
  target.cache += src.cache;
  target.output += src.output;
  target.total += src.input + src.cache + src.output;
  target.steps += src.steps;
}

function emptyBucket() {
  return { input: 0, cache: 0, output: 0, total: 0, steps: 0, activeDays: 0 };
}

export function aggregateOverview({
  desktopDir,
  cliDir,
  sourceFilter = 'all',
  referenceModel = 'gemini-3.8-flash',
  modelMap = {},
  trajectorySummaries = {},
  nowMs = Date.now(),
}) {
  const desktopItems = sourceFilter === 'cli' ? [] : scanBrainDir(desktopDir, 'desktop');
  const cliItems = sourceFilter === 'desktop' ? [] : scanBrainDir(cliDir, 'cli');
  const allItems = [...desktopItems, ...cliItems];

  const dailyMap = {};
  for (const item of allItems) {
    for (const [dayKey, d] of Object.entries(item.daily)) {
      if (!dailyMap[dayKey]) dailyMap[dayKey] = { input: 0, cache: 0, output: 0, total: 0, steps: 0 };
      addDayTotals(dailyMap[dayKey], d);
    }
  }

  const now = new Date(nowMs);
  const todayKey = localDateKey(nowMs);
  const monthPrefix = todayKey.slice(0, 7);
  const yearPrefix = todayKey.slice(0, 4);

  const totalBucket = emptyBucket();
  const todayBucket = emptyBucket();
  const monthBucket = emptyBucket();
  const yearBucket = emptyBucket();

  const sortedDays = Object.keys(dailyMap).sort();
  for (const day of sortedDays) {
    const d = dailyMap[day];
    addDayTotals(totalBucket, d);
    totalBucket.activeDays += 1;
    if (day === todayKey) {
      addDayTotals(todayBucket, d);
      todayBucket.activeDays += 1;
    }
    if (day.startsWith(monthPrefix)) {
      addDayTotals(monthBucket, d);
      monthBucket.activeDays += 1;
    }
    if (day.startsWith(yearPrefix)) {
      addDayTotals(yearBucket, d);
      yearBucket.activeDays += 1;
    }
  }

  const attachCost = (b) => {
    const c = calculateReferenceCost(
      { inputTokens: b.input, cacheReadTokens: b.cache, outputTokens: b.output },
      referenceModel,
      modelMap
    );
    return {
      ...b,
      costUSD: c.totalCostUSD,
      inputCostUSD: c.inputCostUSD,
      cacheCostUSD: c.cacheCostUSD,
      outputCostUSD: c.outputCostUSD,
    };
  };

  // Build 364-day grid (52 weeks) ending today
  const dailySeries = [];
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 363);
  for (let i = 0; i < 364; i++) {
    const dt = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i);
    const key = localDateKey(dt.getTime());
    const d = dailyMap[key] || { input: 0, cache: 0, output: 0, total: 0, steps: 0 };
    const c = calculateReferenceCost({ inputTokens: d.input, cacheReadTokens: d.cache, outputTokens: d.output }, referenceModel, modelMap);
    dailySeries.push({ date: key, weekday: dt.getDay(), ...d, costUSD: c.totalCostUSD });
  }

  // Weekly bars (last 16 weeks)
  const weeklyMap = new Map();
  for (const d of dailySeries.slice(-112)) {
    const dt = new Date(d.date + 'T00:00:00');
    const diffToMon = (dt.getDay() + 6) % 7;
    const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - diffToMon);
    const wkKey = localDateKey(mon.getTime());
    if (!weeklyMap.has(wkKey)) weeklyMap.set(wkKey, { weekStart: wkKey, input: 0, cache: 0, output: 0, total: 0, steps: 0 });
    addDayTotals(weeklyMap.get(wkKey), d);
  }
  const weeklySeries = [...weeklyMap.values()];

  // Monthly calendar (current month)
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthlyCalendar = {
    month: monthPrefix,
    firstWeekday: firstOfMonth.getDay(),
    days: [],
  };
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${monthPrefix}-${String(day).padStart(2, '0')}`;
    const d = dailyMap[key] || { input: 0, cache: 0, output: 0, total: 0, steps: 0 };
    monthlyCalendar.days.push({ day, date: key, ...d });
  }

  // Yearly 12 months
  const yearlyMonths = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = `${yearPrefix}-${String(m).padStart(2, '0')}`;
    const b = { month: prefix, label: `${m}月`, input: 0, cache: 0, output: 0, total: 0, steps: 0 };
    for (const day of sortedDays) {
      if (day.startsWith(prefix)) addDayTotals(b, dailyMap[day]);
    }
    yearlyMonths.push(b);
  }

  // Cumulative series (all recorded active days, downsampled to <=60 points if needed)
  let runningTotal = 0;
  const rawCum = sortedDays.map((day) => {
    runningTotal += dailyMap[day].total;
    return { date: day, dayTotal: dailyMap[day].total, cumulative: runningTotal };
  });
  let cumulativeSeries = rawCum;
  if (rawCum.length > 60) {
    const step = Math.ceil(rawCum.length / 60);
    cumulativeSeries = rawCum.filter((_, idx) => idx % step === 0 || idx === rawCum.length - 1);
  }

  // Recent conversations
  const recentConversations = allItems
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, 25)
    .map((item) => {
      const c = calculateReferenceCost(
        { inputTokens: item.inputTokens, cacheReadTokens: item.cacheReadTokens, outputTokens: item.outputTokens },
        referenceModel,
        modelMap
      );
      const traj = trajectorySummaries[item.conversationId];
      return {
        conversationId: item.conversationId,
        title: traj?.summary || null,
        source: item.source,
        updatedAtMs: item.updatedAtMs,
        latestContextUsed: item.latestContextUsed,
        inputTokens: item.inputTokens,
        cacheReadTokens: item.cacheReadTokens,
        outputTokens: item.outputTokens,
        totalTokens: item.totalTokens,
        plannerSteps: item.plannerSteps,
        costUSD: c.totalCostUSD,
      };
    });

  return {
    sourceFilter,
    referenceModel,
    conversationCount: allItems.length,
    desktopCount: desktopItems.length,
    cliCount: cliItems.length,
    cards: {
      total: attachCost(totalBucket),
      today: attachCost(todayBucket),
      month: attachCost(monthBucket),
      year: attachCost(yearBucket),
    },
    charts: {
      dailySeries,
      weeklySeries,
      monthlyCalendar,
      yearlyMonths,
      cumulativeSeries,
    },
    recentConversations,
  };
}
