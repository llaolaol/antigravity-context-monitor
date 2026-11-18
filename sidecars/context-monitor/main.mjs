import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import {
  aggregateOverview,
  computeConversationMetrics,
  isValidConversationId,
  parseTranscriptJsonl,
} from './metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const DESKTOP_BRAIN_DIR = process.env.ANTIGRAVITY_APP_DATA_DIR
  ? join(process.env.ANTIGRAVITY_APP_DATA_DIR, 'brain')
  : join(HOME, '.gemini', 'antigravity', 'brain');
const CLI_BRAIN_DIR = process.env.AG_CLI_DIR
  ? join(process.env.AG_CLI_DIR, 'brain')
  : join(HOME, '.gemini', 'antigravity-cli', 'brain');

const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
  || join(HOME, '.gemini', 'antigravity', 'sidecar_data', 'context-monitor', 'data');
const PREFS_PATH = join(DATA_DIR, 'prefs.json');

const DEFAULT_PREFS = {
  lang: 'zh-CN',
  budgetPref: 'auto',
  currency: 'CNY',
  subscriptionPreset: 'ai_pro',
  customPaidMonthly: 19.99,
  referenceModel: 'gemini-3.8-flash',
  heatmapTheme: 'emerald',
};

function loadPrefs() {
  try {
    if (existsSync(PREFS_PATH)) {
      const parsed = JSON.parse(readFileSync(PREFS_PATH, 'utf-8'));
      return { ...DEFAULT_PREFS, ...(parsed || {}) };
    }
  } catch {
    // Use defaults
  }
  return { ...DEFAULT_PREFS };
}

function savePrefs(next) {
  const merged = { ...loadPrefs(), ...(next || {}) };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PREFS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function callLanguageServer(method, body = {}, timeoutMs = 2500) {
  const addr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!addr || !csrf) return Promise.resolve(null);

  const [host, portStr] = addr.split(':');
  const port = Number(portStr) || 80;
  const payload = JSON.stringify(body);

  return new Promise((resolve) => {
    const req = httpRequest(
      {
        hostname: host || '127.0.0.1',
        port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-codeium-csrf-token': csrf,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

let userStatusCache = { at: 0, modelMap: {}, account: null };
async function getUserStatusCached(force = false) {
  const now = Date.now();
  if (!force && now - userStatusCache.at < 30_000 && userStatusCache.account) {
    return userStatusCache;
  }
  const res = await callLanguageServer('GetUserStatus', {}, 2500);
  if (!res?.userStatus) return userStatusCache;

  const us = res.userStatus;
  const modelMap = {};
  const quotas = [];
  const seenQuotaGroups = new Set();

  for (const cfg of us.cascadeModelConfigData?.clientModelConfigs || []) {
    const modelId = cfg?.modelOrAlias?.model;
    const label = cfg?.label;
    if (modelId && label) modelMap[modelId] = label;

    const qi = cfg?.quotaInfo;
    if (label && qi && typeof qi.remainingFraction === 'number') {
      const group = label.replace(/\s*\((Low|Medium|High|XHigh)\)\s*$/i, '').trim();
      const key = `${group}|${qi.resetTime || ''}`;
      if (!seenQuotaGroups.has(key)) {
        seenQuotaGroups.add(key);
        quotas.push({
          group,
          remainingPercent: Math.max(0, Math.min(100, Math.round(qi.remainingFraction * 1000) / 10)),
          resetTime: qi.resetTime || null,
        });
      }
    }
  }

  const ps = us.planStatus || {};
  const pi = ps.planInfo || {};
  const account = {
    tierName: us.userTier?.name || pi.planName || 'Unknown',
    teamsTier: pi.teamsTier || null,
    promptCredits: {
      available: ps.availablePromptCredits ?? null,
      monthly: pi.monthlyPromptCredits ?? null,
    },
    flowCredits: {
      available: ps.availableFlowCredits ?? null,
      monthly: pi.monthlyFlowCredits ?? null,
    },
    quotas,
  };

  userStatusCache = { at: now, modelMap, account };
  return userStatusCache;
}

let trajCache = { at: 0, summaries: {} };
async function getTrajectoriesCached() {
  const now = Date.now();
  if (now - trajCache.at < 5_000) return trajCache.summaries;
  const res = await callLanguageServer('GetAllCascadeTrajectories', {}, 2500);
  if (res?.trajectorySummaries) {
    trajCache = { at: now, summaries: res.trajectorySummaries };
  }
  return trajCache.summaries;
}

function findTranscriptPath(convId) {
  for (const dir of [DESKTOP_BRAIN_DIR, CLI_BRAIN_DIR]) {
    const std = join(dir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (existsSync(std)) return std;
    const flat = join(dir, convId, 'transcript.jsonl');
    if (existsSync(flat)) return flat;
  }
  return null;
}

function readTranscriptCached(filePath) {
  if (!filePath) return { records: [], sig: 'none' };
  try {
    const st = statSync(filePath);
    const records = parseTranscriptJsonl(readFileSync(filePath, 'utf-8'));
    return { records, sig: `${st.size}:${st.mtimeMs}` };
  } catch {
    return { records: [], sig: 'err' };
  }
}

const app = new SidecarApp();

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

for (const [route, file, type] of [
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/i18n.js', 'i18n.js', 'application/javascript; charset=utf-8'],
  ['/pricing-client.js', 'pricing-client.js', 'application/javascript; charset=utf-8'],
  ['/charts.js', 'charts.js', 'application/javascript; charset=utf-8'],
  ['/app.js', 'app.js', 'application/javascript; charset=utf-8'],
]) {
  app.api(route, () => new Response(readFileSync(join(__dirname, file), 'utf-8'), { contentType: type }), 'GET');
}

app.api('/api/prefs', () => loadPrefs(), 'GET');

app.api('/api/prefs', (data) => {
  const allowed = {};
  if (data.lang === 'zh-CN' || data.lang === 'en') allowed.lang = data.lang;
  if (typeof data.budgetPref === 'string') allowed.budgetPref = data.budgetPref;
  if (typeof data.currency === 'string') allowed.currency = data.currency;
  if (typeof data.subscriptionPreset === 'string') allowed.subscriptionPreset = data.subscriptionPreset;
  if (data.customPaidMonthly !== undefined && Number.isFinite(Number(data.customPaidMonthly))) {
    allowed.customPaidMonthly = Math.max(0, Number(data.customPaidMonthly));
  }
  if (typeof data.referenceModel === 'string') allowed.referenceModel = data.referenceModel;
  if (typeof data.heatmapTheme === 'string') allowed.heatmapTheme = data.heatmapTheme;
  return savePrefs(allowed);
}, 'POST');

app.api('/api/metrics', async (data) => {
  const convId = String(data.conversationId || app.config.conversationId || '').trim();
  const prefs = loadPrefs();
  const [{ modelMap, account }, summaries] = await Promise.all([
    getUserStatusCached(),
    getTrajectoriesCached(),
  ]);

  if (!isValidConversationId(convId)) {
    return { conversationId: null, empty: true, account, prefs };
  }

  const summaryMeta = summaries[convId] || null;
  const transcriptPath = findTranscriptPath(convId);
  const { sig: fileSig, records: transcriptRecords } = readTranscriptCached(transcriptPath);

  // Check if LS trajectory exists in memory
  let lsSteps = null;
  const lsStepCount = summaryMeta?.stepCount ?? 0;
  const etag = `${convId}|${lsStepCount}|${summaryMeta?.lastModifiedTime || ''}|${fileSig}|${prefs.budgetPref}|${prefs.currency}|${prefs.lang || 'zh-CN'}`;
  if (data.etag && data.etag === etag) {
    return { conversationId: convId, unchanged: true, etag, account, prefs };
  }

  const lsRes = await callLanguageServer('GetCascadeTrajectorySteps', { cascadeId: convId }, 3000);
  if (Array.isArray(lsRes?.steps) && lsRes.steps.length > 0) {
    lsSteps = lsRes.steps;
  }

  const metrics = computeConversationMetrics({
    conversationId: convId,
    lsSteps,
    transcriptRecords,
    modelMap,
    budgetPref: prefs.budgetPref,
    summaryMeta,
  });

  return {
    ...metrics,
    etag,
    account,
    prefs,
  };
}, 'GET');

app.api('/api/overview', async (data) => {
  const sourceFilter = ['all', 'desktop', 'cli'].includes(data.source) ? data.source : 'all';
  const prefs = loadPrefs();
  const [{ modelMap, account }, summaries] = await Promise.all([
    getUserStatusCached(),
    getTrajectoriesCached(),
  ]);

  const overview = aggregateOverview({
    desktopDir: DESKTOP_BRAIN_DIR,
    cliDir: CLI_BRAIN_DIR,
    sourceFilter,
    referenceModel: prefs.referenceModel,
    modelMap,
    trajectorySummaries: summaries,
  });

  return {
    ...overview,
    account,
    prefs,
  };
}, 'GET');

app.run().then((server) => {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(join(DATA_DIR, 'runtime.json'), JSON.stringify({
      port: server.address().port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }), 'utf-8');
  } catch {
    // Non-fatal
  }
});
