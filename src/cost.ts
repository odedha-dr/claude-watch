export interface ModelPricing {
  input: number;    // per 1M tokens
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

// Ordered longest-prefix-first so findPricing matches correctly
const MODEL_PRICING_ENTRIES: [string, ModelPricing][] = [
  // Opus 4.6 / 4.5 — new pricing
  ['claude-opus-4-6',   { input: 5.00,  output: 25.00, cacheWrite: 6.25,  cacheRead: 0.50 }],
  ['claude-opus-4-5',   { input: 5.00,  output: 25.00, cacheWrite: 6.25,  cacheRead: 0.50 }],
  // Opus 4.1 / 4.0 — legacy pricing
  ['claude-opus-4-1',   { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 }],
  ['claude-opus-4-0',   { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 }],
  ['claude-opus-4',     { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 }],
  // Sonnet — all versions same pricing
  ['claude-sonnet-4',   { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 }],
  // Haiku 4.5
  ['claude-haiku-4-5',  { input: 1.00,  output: 5.00,  cacheWrite: 1.25,  cacheRead: 0.10 }],
  // Haiku 3.5
  ['claude-haiku-3-5',  { input: 0.80,  output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 }],
  // Haiku 3
  ['claude-3-haiku',    { input: 0.25,  output: 1.25,  cacheWrite: 0.30,  cacheRead: 0.03 }],
];

const DEFAULT_PRICING: ModelPricing = { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 };

function findPricing(model: string): ModelPricing {
  for (const [prefix, pricing] of MODEL_PRICING_ENTRIES) {
    if (model.startsWith(prefix)) {
      return pricing;
    }
  }
  return DEFAULT_PRICING;
}

export function calculateCost(
  model: string,
  tokens: { input: number; output: number; cacheCreation: number; cacheRead: number },
): CostBreakdown {
  const pricing = findPricing(model);
  const perM = 1_000_000;

  const input = (tokens.input / perM) * pricing.input;
  const output = (tokens.output / perM) * pricing.output;
  const cacheWrite = (tokens.cacheCreation / perM) * pricing.cacheWrite;
  const cacheRead = (tokens.cacheRead / perM) * pricing.cacheRead;

  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    total: input + output + cacheWrite + cacheRead,
  };
}
