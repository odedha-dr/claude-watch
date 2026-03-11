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

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4': { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-haiku-4': { input: 0.80, output: 4.00, cacheWrite: 1.00, cacheRead: 0.08 },
};

const DEFAULT_PRICING_KEY = 'claude-sonnet-4';

function findPricing(model: string): ModelPricing {
  for (const prefix of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(prefix)) {
      return MODEL_PRICING[prefix];
    }
  }
  return MODEL_PRICING[DEFAULT_PRICING_KEY];
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
