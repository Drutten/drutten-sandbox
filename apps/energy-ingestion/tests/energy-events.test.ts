import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {createEnergyImportStagedEvent} from '../src/energy-events.ts';

const data = {
  importId: 'import-123',
  bucketName: 'energy-uploads',
  objectName: 'energy.csv',
  objectGeneration: '42',
  rowCount: 6,
  validRowCount: 5,
  invalidRowCount: 1,
};

describe('createEnergyImportStagedEvent', () => {
  it('creates the same event ID for retries of the same import', () => {
    const first = createEnergyImportStagedEvent(data, '2026-08-01T10:00:00Z');
    const retry = createEnergyImportStagedEvent(data, '2026-08-01T10:01:00Z');

    assert.equal(first.eventId, retry.eventId);
    assert.equal(first.eventType, 'EnergyImportStaged');
  });

  it('creates a different event ID for a different import', () => {
    const first = createEnergyImportStagedEvent(data);
    const second = createEnergyImportStagedEvent({
      ...data,
      importId: 'import-456',
    });

    assert.notEqual(first.eventId, second.eventId);
  });
});
