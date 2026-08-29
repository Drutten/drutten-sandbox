import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {EnergyRecordAnalysis} from '../src/analyze-energy-records.ts';
import {
  BigQueryConsumptionAlertWriter,
  createAlertId,
  createAlertMergeJobId,
  createConsumptionAlert,
} from '../src/consumption-alerts.ts';

describe('consumption alerts', () => {
  it('creates a deterministic alert from an anomaly', () => {
    const alert = createConsumptionAlert(
      'import-1',
      'completed-event-1',
      anomaly(),
    );

    assert.equal(alert.alertId, createAlertId('record-1'));
    assert.equal(alert.changePercent, 50);
    assert.equal(alert.sourceImportId, 'import-1');
    assert.equal(alert.sourceCompletedEventId, 'completed-event-1');
    assert.equal(createAlertId('record-1'), createAlertId('record-1'));
    assert.notEqual(createAlertId('record-1'), createAlertId('record-2'));
  });

  it('rejects a result that is not an anomaly', () => {
    const analysis = anomaly();
    analysis.result = {
      isAnomaly: false,
      changePercent: 20,
      reason: 'WITHIN_THRESHOLD',
    };

    assert.throws(
      () => createConsumptionAlert('import-1', 'event-1', analysis),
      /requires a comparable anomaly/,
    );
  });

  it('merges alerts by alert_id with a deterministic job ID', async () => {
    const calls: unknown[] = [];
    const writer = new BigQueryConsumptionAlertWriter(
      'energy',
      'europe-west1',
      async options => {
        calls.push(options);
        return {affectedRowCount: '1', reusedExistingJob: false};
      },
    );
    const alert = createConsumptionAlert('import-1', 'event-1', anomaly());

    const result = await writer.merge([alert], 'event-1');

    assert.equal(result.jobId, createAlertMergeJobId('event-1'));
    assert.equal(result.affectedRowCount, 1);
    const call = calls[0] as Record<string, unknown>;
    assert.equal(call.location, 'europe-west1');
    assert.equal(call.useLegacySql, false);
    assert.deepEqual(
      JSON.parse(String((call.params as {alertsJson: string}).alertsJson)),
      [alert],
    );
    assert.match(String(call.query), /MERGE `energy\.consumption_alerts`/);
    assert.match(String(call.query), /ON target\.alert_id = source\.alert_id/);
    assert.match(String(call.query), /WHEN MATCHED THEN/);
    assert.match(String(call.query), /WHEN NOT MATCHED THEN/);
  });
});

function anomaly(): EnergyRecordAnalysis {
  return {
    record: {
      recordId: 'record-1',
      meterId: 'home-01',
      periodStart: '2026-05-01',
      consumptionKwh: '90',
      totalCostSek: '400',
      previousRecordId: 'record-0',
      previousPeriodStart: '2026-04-01',
      previousConsumptionKwh: '60',
      previousTotalCostSek: '300',
    },
    result: {
      isAnomaly: true,
      changePercent: 50,
      reason: 'INCREASE_ABOVE_THRESHOLD',
    },
  };
}
