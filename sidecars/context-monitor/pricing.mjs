/**
 * Model catalog, context window budgets, reference API pricing, and subscription presets.
 * Reference API pricing is for comparative estimation only; actual billing depends on provider.
 */

export const CONTEXT_BUDGET_PRESETS = [
  { id: 'auto', label: '自动识别', tokens: null },
  { id: '200k', label: '200K', tokens: 200_000 },
  { id: '983k', label: '983K', tokens: 983_040 },
  { id: '1m', label: '1M', tokens: 1_048_576 },
  { id: '2m', label: '2M', tokens: 2_097_152 },
];

export const CURRENCY_RATES = {
  USD: { symbol: '$', rate: 1, name: '美元 (USD)' },
  CNY: { symbol: '¥', rate: 7.25, name: '人民币 (CNY)' },
  EUR: { symbol: '€', rate: 0.92, name: '欧元 (EUR)' },
  GBP: { symbol: '£', rate: 0.79, name: '英镑 (GBP)' },
  JPY: { symbol: '¥', rate: 154, name: '日元 (JPY)' },
  HKD: { symbol: 'HK$', rate: 7.78, name: '港币 (HKD)' },
  TWD: { symbol: 'NT$', rate: 32.3, name: '新台币 (TWD)' },
};

export const SUBSCRIPTION_PRESETS = [
  { id: 'ai_pro', label: 'Google AI Pro', monthlyUSD: 19.99 },
  { id: 'ai_ultra', label: 'Google AI Ultra', monthlyUSD: 249.99 },
  { id: 'ai_plus', label: 'Google AI Plus', monthlyUSD: 7.99 },
  { id: 'free', label: 'Free / 赠送权益', monthlyUSD: 0 },
  { id: 'custom', label: '自定义实付', monthlyUSD: null },
];

// Reference API rates ($ per 1M tokens). Cache read defaults to 10% of input unless tiered.
export const PRICING_TABLE = {
  'gemini-3.8-flash': {
    displayName: 'Gemini 3.8 Flash',
    contextLimit: 1_048_576,
    tiers: [
      { inputPerMillion: 0.75, cacheReadPerMillion: 0.075, outputPerMillion: 3.75 },
    ],
  },
  'gemini-4-argon': {
    displayName: 'Gemini 4 Argon',
    contextLimit: 1_048_576,
    tiers: [
      { inputPerMillion: 2.00, cacheReadPerMillion: 0.20, outputPerMillion: 10.00 },
    ],
  },
  'gemini-4-hydrogen': {
    displayName: 'Gemini 4 Hydrogen',
    contextLimit: 1_048_576,
    tiers: [
      { inputPerMillion: 1.25, cacheReadPerMillion: 0.125, outputPerMillion: 7.50 },
    ],
  },
  'gemini-4-carbon': {
    displayName: 'Gemini 4 Carbon',
    contextLimit: 1_048_576,
    tiers: [
      { maxPromptTokens: 200_000, inputPerMillion: 2.50, cacheReadPerMillion: 0.25, outputPerMillion: 15.00 },
      { minPromptTokens: 200_001, inputPerMillion: 5.00, cacheReadPerMillion: 0.50, outputPerMillion: 22.50 },
    ],
  },
  'claude-opus': {
    displayName: 'Claude Opus',
    contextLimit: 200_000,
    tiers: [
      { inputPerMillion: 15.00, cacheReadPerMillion: 1.50, outputPerMillion: 75.00 },
    ],
  },
  'claude-sonnet': {
    displayName: 'Claude Sonnet',
    contextLimit: 200_000,
    tiers: [
      { inputPerMillion: 3.00, cacheReadPerMillion: 0.30, outputPerMillion: 15.00 },
    ],
  },
  'gpt-oss-120b': {
    displayName: 'GPT-OSS 120B',
    contextLimit: 131_072,
    tiers: [
      { inputPerMillion: 0.50, cacheReadPerMillion: 0.05, outputPerMillion: 1.50 },
    ],
  },
};

// Known placeholder IDs observed from Antigravity LanguageServer GetUserStatus
const PLACEHOLDER_MAP = {
  MODEL_PLACEHOLDER_M318: { key: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (High)' },
  MODEL_PLACEHOLDER_M319: { key: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Medium)' },
  MODEL_PLACEHOLDER_M320: { key: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Low)' },
  MODEL_PLACEHOLDER_M417: { key: 'gemini-4-argon', label: 'Gemini 4 Argon (High)' },
  MODEL_PLACEHOLDER_M418: { key: 'gemini-4-argon', label: 'Gemini 4 Argon (Medium)' },
  MODEL_PLACEHOLDER_M419: { key: 'gemini-4-argon', label: 'Gemini 4 Argon (Low)' },
  MODEL_PLACEHOLDER_M525: { key: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (High)' },
  MODEL_PLACEHOLDER_M526: { key: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Medium)' },
  MODEL_PLACEHOLDER_M527: { key: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Low)' },
  MODEL_PLACEHOLDER_M528: { key: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (XHigh)' },
  MODEL_PLACEHOLDER_M668: { key: 'gemini-4-argon', label: 'Orchestrator (Argon)' },
  MODEL_PLACEHOLDER_M670: { key: 'gemini-4-carbon', label: 'Gemini 4 Carbon' },
  MODEL_PLACEHOLDER_M400: { key: 'claude-opus', label: 'Claude Opus 5.5 (Low)' },
  MODEL_PLACEHOLDER_M401: { key: 'claude-opus', label: 'Claude Opus 5.5 (Medium)' },
  MODEL_PLACEHOLDER_M402: { key: 'claude-opus', label: 'Claude Opus 5.5 (High)' },
  MODEL_PLACEHOLDER_M403: { key: 'claude-sonnet', label: 'Claude Sonnet 5.5 (Low)' },
  MODEL_PLACEHOLDER_M404: { key: 'claude-sonnet', label: 'Claude Sonnet 5.5 (Medium)' },
  MODEL_PLACEHOLDER_M405: { key: 'claude-sonnet', label: 'Claude Sonnet 5.5 (High)' },
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: { key: 'gpt-oss-120b', label: 'GPT-OSS 120B (Medium)' },
};

export function normalizeModelKey(rawModel, dynamicLabelMap = {}) {
  const raw = String(rawModel || '').trim();
  const label = dynamicLabelMap[raw] || PLACEHOLDER_MAP[raw]?.label || raw;
  const lower = label.toLowerCase();

  if (lower.includes('carbon')) return { key: 'gemini-4-carbon', label };
  if (lower.includes('hydrogen')) return { key: 'gemini-4-hydrogen', label };
  if (lower.includes('argon')) return { key: 'gemini-4-argon', label };
  if (lower.includes('flash')) return { key: 'gemini-3.8-flash', label };
  if (lower.includes('opus')) return { key: 'claude-opus', label };
  if (lower.includes('sonnet')) return { key: 'claude-sonnet', label };
  if (lower.includes('gpt-oss') || lower.includes('gpt_oss')) return { key: 'gpt-oss-120b', label };

  if (PLACEHOLDER_MAP[raw]) {
    return { key: PLACEHOLDER_MAP[raw].key, label };
  }
  return { key: 'gemini-3.8-flash', label: label || '未知模型 (按 Flash 参考)' , isFallback: true };
}

export function getModelContextLimit(rawModel, dynamicLabelMap = {}, budgetPref = 'auto') {
  if (budgetPref && budgetPref !== 'auto') {
    const found = CONTEXT_BUDGET_PRESETS.find((p) => p.id === budgetPref);
    if (found?.tokens) return { limit: found.tokens, source: 'manual', label: found.label };
  }
  const { key } = normalizeModelKey(rawModel, dynamicLabelMap);
  const spec = PRICING_TABLE[key] || PRICING_TABLE['gemini-3.8-flash'];
  return { limit: spec.contextLimit, source: 'model', label: spec.displayName };
}

export function calculateReferenceCost(usage = {}, rawModel = '', dynamicLabelMap = {}) {
  const input = Math.max(0, Number(usage.inputTokens ?? usage.input ?? 0));
  const cache = Math.max(0, Number(usage.cacheReadTokens ?? usage.cache ?? 0));
  const output = Math.max(0, Number(usage.outputTokens ?? usage.output ?? 0));

  const { key, label, isFallback } = normalizeModelKey(rawModel, dynamicLabelMap);
  const entry = PRICING_TABLE[key] || PRICING_TABLE['gemini-3.8-flash'];
  const promptTotal = input + cache;

  let tier = entry.tiers[0];
  for (const t of entry.tiers) {
    if (t.maxPromptTokens && promptTotal > t.maxPromptTokens) continue;
    if (t.minPromptTokens && promptTotal < t.minPromptTokens) continue;
    tier = t;
    break;
  }

  const inputCostUSD = (input * tier.inputPerMillion) / 1_000_000;
  const cacheCostUSD = (cache * tier.cacheReadPerMillion) / 1_000_000;
  const outputCostUSD = (output * tier.outputPerMillion) / 1_000_000;
  const totalCostUSD = inputCostUSD + cacheCostUSD + outputCostUSD;

  return {
    modelKey: key,
    modelLabel: label,
    isFallback: Boolean(isFallback),
    rates: tier,
    inputCostUSD,
    cacheCostUSD,
    outputCostUSD,
    totalCostUSD,
  };
}
