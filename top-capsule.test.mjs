import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { buildPayload, extractConvIdFromUrl, resolveDevToolsPortFile } from './top-capsule.mjs';
import './sidecars/context-monitor/i18n.js';

const { DICT, normalizeLang, t } = globalThis.__CM_I18N;

test('resolveDevToolsPortFile resolves macOS, Windows, and env override paths', () => {
  assert.equal(
    resolveDevToolsPortFile({
      platform: 'darwin',
      home: '/Users/demo',
      env: {},
    }),
    join('/Users/demo', 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
  );

  assert.equal(
    resolveDevToolsPortFile({
      platform: 'win32',
      home: 'C:\\Users\\demo',
      env: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' },
    }),
    join('C:\\Users\\demo\\AppData\\Roaming', 'Antigravity', 'DevToolsActivePort')
  );

  assert.equal(
    resolveDevToolsPortFile({
      platform: 'win32',
      home: '/home/demo',
      env: { ANTIGRAVITY_DEVTOOLS_PORT_FILE: '/custom/DevToolsActivePort' },
    }),
    '/custom/DevToolsActivePort'
  );
});

test('extractConvIdFromUrl parses /c/<id> and query param safely', () => {
  const id = '77ed0c05-d03c-40a0-99ce-35c5b499d352';
  assert.equal(extractConvIdFromUrl(`https://127.0.0.1:5000/c/${id}`), id);
  assert.equal(extractConvIdFromUrl(`https://127.0.0.1:5000/?conversationId=${id}`), id);
  assert.equal(extractConvIdFromUrl('https://127.0.0.1:5000/c/../../etc/passwd'), '');
});

test('buildPayload formats zh-CN (default) and en capsule outputs cleanly', () => {
  const baseMetrics = {
    budget: { used: 50_000, limit: 1_000_000, percent: 5.0, health: 'normal' },
    latestStep: { cacheHitRate: 90, tokensPerSec: 120.5, ttftMs: 1200, costUSD: 0.01 },
    sessionTotals: { plannerCount: 3, inputTokens: 5000, cacheReadTokens: 45_000, outputTokens: 800, costUSD: 0.1 },
    model: { label: 'Gemini 4 Hydrogen (High)' },
    account: { quotas: [{ group: 'Gemini 4 Hydrogen', remainingPercent: 80 }] },
    prefs: { currency: 'CNY', lang: 'zh-CN' },
  };

  const zh = buildPayload(baseMetrics);
  assert.equal(zh.active, true);
  assert.equal(zh.lang, 'zh-CN');
  assert.equal(zh.modelUsageText, 'Gemini 4 Hydrogen 20%/100%');
  assert.equal(zh.costCapsuleText, '当前会话合计(¥0.73)');
  assert.match(zh.tooltip, /模型: Gemini 4 Hydrogen \(High\)/);

  const en = buildPayload({
    ...baseMetrics,
    prefs: { currency: 'USD', lang: 'en' },
  });
  assert.equal(en.lang, 'en');
  assert.equal(en.costCapsuleText, 'Session($0.10)');
  assert.match(en.tooltip, /Model: Gemini 4 Hydrogen \(High\)/);
  assert.match(en.tooltip, /20% used \/ 100%/);

  assert.deepEqual(buildPayload(null), { active: false });
  assert.deepEqual(buildPayload({ empty: true }), { active: false });
});

test('i18n dictionary maintains key parity between zh-CN and en', () => {
  const zhKeys = Object.keys(DICT['zh-CN']).sort();
  const enKeys = Object.keys(DICT.en).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('fr'), 'zh-CN');
  assert.equal(t('en', 'audit.rounds', { n: 5 }), '5 turns');
  assert.equal(t('zh-CN', 'audit.rounds', { n: 5 }), '5 轮');
});
