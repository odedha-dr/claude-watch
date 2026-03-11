import { describe, it, expect } from 'vitest';
import { calculateCost, MODEL_PRICING } from '../cost.js';

describe('calculateCost', () => {
  it('returns correct cost for known model (opus)', () => {
    const result = calculateCost('claude-opus-4', {
      input: 1_000_000,
      output: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(result.input).toBeCloseTo(15.00);
    expect(result.output).toBeCloseTo(75.00);
    expect(result.cacheWrite).toBeCloseTo(0);
    expect(result.cacheRead).toBeCloseTo(0);
    expect(result.total).toBeCloseTo(90.00);
  });

  it('matches model with date suffix by prefix', () => {
    const result = calculateCost('claude-opus-4-6-20250101', {
      input: 500_000,
      output: 200_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    // 0.5M * 15 = 7.50, 0.2M * 75 = 15.00
    expect(result.input).toBeCloseTo(7.50);
    expect(result.output).toBeCloseTo(15.00);
    expect(result.total).toBeCloseTo(22.50);
  });

  it('defaults to Sonnet pricing for unknown model', () => {
    const result = calculateCost('some-unknown-model', {
      input: 1_000_000,
      output: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(result.input).toBeCloseTo(3.00);
    expect(result.output).toBeCloseTo(15.00);
    expect(result.total).toBeCloseTo(18.00);
  });

  it('returns zero cost for zero tokens', () => {
    const result = calculateCost('claude-opus-4', {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(result.input).toBe(0);
    expect(result.output).toBe(0);
    expect(result.cacheWrite).toBe(0);
    expect(result.cacheRead).toBe(0);
    expect(result.total).toBe(0);
  });

  it('calculates cache-heavy session correctly', () => {
    const result = calculateCost('claude-haiku-4', {
      input: 100_000,
      output: 50_000,
      cacheCreation: 2_000_000,
      cacheRead: 5_000_000,
    });
    // 0.1M * 0.80 = 0.08
    expect(result.input).toBeCloseTo(0.08);
    // 0.05M * 4.00 = 0.20
    expect(result.output).toBeCloseTo(0.20);
    // 2M * 1.00 = 2.00
    expect(result.cacheWrite).toBeCloseTo(2.00);
    // 5M * 0.08 = 0.40
    expect(result.cacheRead).toBeCloseTo(0.40);
    expect(result.total).toBeCloseTo(2.68);
  });
});
