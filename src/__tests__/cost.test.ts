import { describe, it, expect } from 'vitest';
import { calculateCost } from '../cost.js';

describe('calculateCost', () => {
  it('returns correct cost for Opus 4.6', () => {
    const result = calculateCost('claude-opus-4-6', {
      input: 1_000_000,
      output: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(result.input).toBeCloseTo(5.00);
    expect(result.output).toBeCloseTo(25.00);
    expect(result.total).toBeCloseTo(30.00);
  });

  it('returns correct cost for legacy Opus 4.0', () => {
    const result = calculateCost('claude-opus-4-0', {
      input: 1_000_000,
      output: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(result.input).toBeCloseTo(15.00);
    expect(result.output).toBeCloseTo(75.00);
    expect(result.total).toBeCloseTo(90.00);
  });

  it('matches model with date suffix by prefix', () => {
    const result = calculateCost('claude-opus-4-6-20250101', {
      input: 500_000,
      output: 200_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    // 0.5M * 5 = 2.50, 0.2M * 25 = 5.00
    expect(result.input).toBeCloseTo(2.50);
    expect(result.output).toBeCloseTo(5.00);
    expect(result.total).toBeCloseTo(7.50);
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
    const result = calculateCost('claude-opus-4-6', {
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

  it('calculates cache-heavy session correctly for Haiku 4.5', () => {
    const result = calculateCost('claude-haiku-4-5', {
      input: 100_000,
      output: 50_000,
      cacheCreation: 2_000_000,
      cacheRead: 5_000_000,
    });
    // 0.1M * 1.00 = 0.10
    expect(result.input).toBeCloseTo(0.10);
    // 0.05M * 5.00 = 0.25
    expect(result.output).toBeCloseTo(0.25);
    // 2M * 1.25 = 2.50
    expect(result.cacheWrite).toBeCloseTo(2.50);
    // 5M * 0.10 = 0.50
    expect(result.cacheRead).toBeCloseTo(0.50);
    expect(result.total).toBeCloseTo(3.35);
  });

  it('uses Opus 4.5 pricing for claude-opus-4-5 model', () => {
    const result = calculateCost('claude-opus-4-5-20251101', {
      input: 1_000_000,
      output: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(result.input).toBeCloseTo(5.00);
    expect(result.output).toBeCloseTo(25.00);
    expect(result.total).toBeCloseTo(30.00);
  });

  it('uses Sonnet pricing for all Sonnet versions', () => {
    for (const model of ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4-0']) {
      const result = calculateCost(model, {
        input: 1_000_000,
        output: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
      });
      expect(result.input).toBeCloseTo(3.00);
      expect(result.output).toBeCloseTo(15.00);
    }
  });
});
