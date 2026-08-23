import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {detectConsumptionAnomaly} from '../src/consumption-anomaly.ts';

describe('detectConsumptionAnomaly', () => {
  it('flags an increase greater than 40 percent', () => {
    assert.deepEqual(detectConsumptionAnomaly(141, 100), {
      isAnomaly: true,
      changePercent: 41,
      reason: 'INCREASE_ABOVE_THRESHOLD',
    });
  });

  it('does not flag an increase of exactly 40 percent', () => {
    assert.deepEqual(detectConsumptionAnomaly(140, 100), {
      isAnomaly: false,
      changePercent: 40,
      reason: 'WITHIN_THRESHOLD',
    });
  });

  it('does not flag a decrease', () => {
    assert.deepEqual(detectConsumptionAnomaly(80, 100), {
      isAnomaly: false,
      changePercent: -20,
      reason: 'WITHIN_THRESHOLD',
    });
  });

  it('does not compare a period without history', () => {
    assert.deepEqual(detectConsumptionAnomaly(100), {
      isAnomaly: false,
      changePercent: null,
      reason: 'NO_PREVIOUS_PERIOD',
    });
  });

  it('does not calculate a percentage from a zero baseline', () => {
    assert.deepEqual(detectConsumptionAnomaly(100, 0), {
      isAnomaly: false,
      changePercent: null,
      reason: 'ZERO_PREVIOUS_CONSUMPTION',
    });
  });

  it('rejects invalid consumption values', () => {
    assert.throws(
      () => detectConsumptionAnomaly(Number.NaN, 100),
      /consumptionKwh must be a finite non-negative number/,
    );
    assert.throws(
      () => detectConsumptionAnomaly(100, -1),
      /previousConsumptionKwh must be a finite non-negative number/,
    );
  });
});
