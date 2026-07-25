import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordId } from '../src/identifiers.ts';

describe('createRecordId', () => {
  it('returns the same ID for the same meter and period', () => {
    const first = createRecordId('home-01', '2026-06-01', '2026-06-30');
    const second = createRecordId('home-01', '2026-06-01', '2026-06-30');

    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  it('returns a different ID for a different logical period', () => {
    const june = createRecordId('home-01', '2026-06-01', '2026-06-30');
    const may = createRecordId('home-01', '2026-05-01', '2026-05-31');

    assert.notEqual(june, may);
  });

  it('normalizes surrounding whitespace', () => {
    assert.equal(
      createRecordId(' home-01 ', ' 2026-06-01', '2026-06-30 '),
      createRecordId('home-01', '2026-06-01', '2026-06-30'),
    );
  });
});
