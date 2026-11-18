#!/usr/bin/env node
/**
 * Compatibility entry & test re-export for the titlebar top capsule.
 * Since v1.1.0, the sidecar (`sidecars/context-monitor/main.mjs`) starts the
 * top capsule automatically when the plugin is enabled. This standalone CLI
 * entry remains available for manual debugging.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPayload,
  extractConvIdFromUrl,
  resolveDevToolsPortFile,
  startTopCapsule,
} from './sidecars/context-monitor/capsule.mjs';
import { computeConversationMetrics, isValidConversationId, parseTranscriptJsonl } from './sidecars/context-monitor/metrics.mjs';

export { buildPayload, extractConvIdFromUrl, resolveDevToolsPortFile, startTopCapsule };

const __filename = fileURLToPath(import.meta.url);
const isMainModule = Boolean(process.argv[1]) && resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const HOME = homedir();
  const SIDECAR_DATA_DIR = process.env.ANTIGRAVITY_SIDECAR_DATA_DIR
    || join(HOME, '.gemini', 'antigravity', 'sidecar_data', 'context-monitor', 'context-monitor');
  const RUNTIME_FILE = join(SIDECAR_DATA_DIR, 'data', 'runtime.json');
  const SIDECAR_LOG = join(SIDECAR_DATA_DIR, 'logs', 'sidecar.log');
  const DESKTOP_BRAIN_DIR = process.env.ANTIGRAVITY_BRAIN_DIR
    || (process.env.ANTIGRAVITY_APP_DATA_DIR
      ? join(process.env.ANTIGRAVITY_APP_DATA_DIR, 'brain')
      : join(HOME, '.gemini', 'antigravity', 'brain'));

  const fallbackCache = new Map();

  function readSidecarPort() {
    try {
      if (existsSync(RUNTIME_FILE)) {
        const d = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
        if (d?.port) return Number(d.port);
      }
    } catch {}
    try {
      if (existsSync(SIDECAR_LOG)) {
        const txt = readFileSync(SIDECAR_LOG, 'utf8');
        const matches = [...txt.matchAll(/\[sidecar\] listening on 127\.0\.0\.1:(\d+)/g)];
        if (matches.length) return Number(matches[matches.length - 1][1]);
      }
    } catch {}
    return null;
  }

  function getFallbackMetrics(convId) {
    if (!isValidConversationId(convId)) return null;
    const p = join(DESKTOP_BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!existsSync(p)) return null;
    try {
      const st = statSync(p);
      const cached = fallbackCache.get(p);
      if (cached && cached.sig === `${st.size}:${st.mtimeMs}`) return cached.data;
      const recs = parseTranscriptJsonl(readFileSync(p, 'utf8'));
      const data = computeConversationMetrics({ conversationId: convId, transcriptRecords: recs });
      fallbackCache.set(p, { sig: `${st.size}:${st.mtimeMs}`, data });
      return data;
    } catch {
      return null;
    }
  }

  async function fetchMetrics(convId) {
    const scPort = readSidecarPort();
    if (scPort) {
      try {
        const res = await fetch(`http://127.0.0.1:${scPort}/api/metrics?conversationId=${encodeURIComponent(convId || '')}`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    return getFallbackMetrics(convId);
  }

  console.log('[context-monitor] standalone top-capsule daemon started');
  startTopCapsule({ getMetrics: fetchMetrics });
  setInterval(() => {}, 60_000);
}
