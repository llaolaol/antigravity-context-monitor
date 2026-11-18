import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateReferenceCost, getModelContextLimit, normalizeModelKey } from './pricing.mjs';
import {
  aggregateOverview,
  classifyError,
  computeConversationMetrics,
  isValidConversationId,
  parseTranscriptJsonl,
} from './metrics.mjs';

test('normalizeModelKey & getModelContextLimit map placeholders and presets', () => {
  const m1 = normalizeModelKey('MODEL_PLACEHOLDER_M525', { MODEL_PLACEHOLDER_M525: 'Gemini 4 Hydrogen (High)' });
  assert.equal(m1.key, 'gemini-4-hydrogen');
  assert.equal(m1.label, 'Gemini 4 Hydrogen (High)');

  const claude = normalizeModelKey('MODEL_PLACEHOLDER_M402');
  assert.equal(claude.key, 'claude-opus');
  assert.equal(getModelContextLimit('MODEL_PLACEHOLDER_M402', {}, 'auto').limit, 200_000);
  assert.equal(getModelContextLimit('MODEL_PLACEHOLDER_M402', {}, '983k').limit, 983_040);
});

test('calculateReferenceCost applies 10% cache discount and Carbon >200K tier', () => {
  const std = calculateReferenceCost(
    { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 },
    'MODEL_PLACEHOLDER_M318'
  );
  assert.equal(std.inputCostUSD, 0.75);
  assert.equal(std.cacheCostUSD, 0.075);
  assert.equal(std.outputCostUSD, 3.75);

  const carbonHigh = calculateReferenceCost(
    { inputTokens: 100_000, cacheReadTokens: 200_000, outputTokens: 0 },
    'MODEL_PLACEHOLDER_M670'
  );
  assert.equal(carbonHigh.rates.inputPerMillion, 5.00);
  assert.equal(carbonHigh.rates.cacheReadPerMillion, 0.50);
});

test('parseTranscriptJsonl skips partial trailing lines and parses valid entries', () => {
  const raw = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'hello' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 1000, cache_read_tokens: 9000, output_tokens: 200, created_at: '2026-11-13T06:00:00Z' }),
    '{"partial_broken_line":',
  ].join('\n');
  const recs = parseTranscriptJsonl(raw);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].input_tokens, 1000);
});

test('computeConversationMetrics calculates context, TTFT, stream speed, and totals from LS steps', () => {
  const lsSteps = [
    {
      type: 'CORTEX_STEP_TYPE_USER_INPUT',
      status: 'CORTEX_STEP_STATUS_DONE',
      userInput: { items: [{ text: 'hi' }] },
      metadata: { createdAt: '2026-11-13T06:00:00.000Z' },
    },
    {
      type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
      status: 'CORTEX_STEP_STATUS_DONE',
      plannerResponse: { response: 'hello world', thinking: 'hmm', toolCalls: [{ name: 'read_file' }] },
      metadata: {
        createdAt: '2026-11-13T06:00:01.000Z',
        viewableAt: '2026-11-13T06:00:03.000Z',
        finishedGeneratingAt: '2026-11-13T06:00:05.000Z',
        modelUsage: {
          model: 'MODEL_PLACEHOLDER_M525',
          inputTokens: '2000',
          cacheReadTokens: '18000',
          outputTokens: '300',
          thinkingOutputTokens: '100',
          responseOutputTokens: '200',
        },
      },
    },
  ];

  const m = computeConversationMetrics({
    conversationId: '77ed0c05-d03c-40a0-99ce-35c5b499d352',
    lsSteps,
    modelMap: { MODEL_PLACEHOLDER_M525: 'Gemini 4 Hydrogen (High)' },
    budgetPref: 'auto',
  });

  assert.equal(m.dataSource, 'language_server');
  assert.equal(m.budget.used, 20_000);
  assert.equal(m.budget.nextBaseline, 20_300);
  assert.equal(m.latestStep.cacheHitRate, 90);
  assert.equal(m.latestStep.ttftMs, 2000);
  assert.equal(m.latestStep.genDurationMs, 2000);
  assert.equal(m.latestStep.tokensPerSec, 100);
  assert.equal(m.latestStep.speedMode, 'stream');
  assert.equal(m.sessionTotals.toolCalls, 1);
  assert.equal(m.sessionTotals.thinkingTokens, 100);
  assert.equal(m.sessionTotals.responseTokens, 200);
});

test('classifyError & isValidConversationId handle edge cases', () => {
  assert.equal(isValidConversationId('77ed0c05-d03c-40a0-99ce-35c5b499d352'), true);
  assert.equal(isValidConversationId('../../etc/passwd'), false);
  assert.equal(classifyError('ERROR', '429 Too Many Requests / quota exceeded')?.code, 'rate_limit');
  assert.equal(classifyError('ERROR', 'Prompt exceeds the maximum token limit')?.code, 'context_limit');
  assert.equal(classifyError('CORTEX_STEP_STATUS_DONE', ''), null);
});

test('aggregateOverview scans desktop and cli brain directories cleanly', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-test-'));
  try {
    const dConv = join(root, 'desktop', '11111111-1111-1111-1111-111111111111', '.system_generated', 'logs');
    const cConv = join(root, 'cli', '22222222-2222-2222-2222-222222222222', '.system_generated', 'logs');
    mkdirSync(dConv, { recursive: true });
    mkdirSync(cConv, { recursive: true });

    const nowIso = new Date().toISOString();
    writeFileSync(join(dConv, 'transcript.jsonl'), JSON.stringify({
      type: 'PLANNER_RESPONSE',
      input_tokens: 1000,
      cache_read_tokens: 4000,
      output_tokens: 500,
      created_at: nowIso,
    }) + '\n');
    writeFileSync(join(cConv, 'transcript.jsonl'), JSON.stringify({
      type: 'PLANNER_RESPONSE',
      input_tokens: 500,
      cache_read_tokens: 1500,
      output_tokens: 200,
      created_at: nowIso,
    }) + '\n');

    const ovAll = aggregateOverview({ desktopDir: join(root, 'desktop'), cliDir: join(root, 'cli'), sourceFilter: 'all' });
    assert.equal(ovAll.conversationCount, 2);
    assert.equal(ovAll.cards.today.total, 7700);
    assert.equal(ovAll.cards.total.input, 1500);
    assert.equal(ovAll.cards.total.cache, 5500);
    assert.equal(ovAll.cards.total.output, 700);

    const ovCli = aggregateOverview({ desktopDir: join(root, 'desktop'), cliDir: join(root, 'cli'), sourceFilter: 'cli' });
    assert.equal(ovCli.conversationCount, 1);
    assert.equal(ovCli.cards.today.total, 2200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
