import {createServer} from 'node:http';
import {BigQueryConsumptionAlertWriter} from './consumption-alerts.js';
import {handleCompletedEvent} from './handle-completed-event.js';
import {respond} from './http.js';
import {log} from './logging.js';
import {BigQueryEnergyRecordReader} from './energy-records.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const energyRecords = new BigQueryEnergyRecordReader(
  process.env.ENERGY_DATASET_ID ?? 'energy',
  process.env.GCP_REGION,
);
const consumptionAlerts = new BigQueryConsumptionAlertWriter(
  process.env.ENERGY_DATASET_ID ?? 'energy',
  process.env.GCP_REGION,
);

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    respond(response, 200, {status: 'ok'});
    return;
  }
  if (request.method !== 'POST') {
    respond(response, 405, {error: 'Method not allowed'});
    return;
  }
  void handleCompletedEvent(request, response, {
    energyRecords,
    consumptionAlerts,
  });
});

server.listen(port, host, () => {
  console.log(`energy-anomaly-detection listening on http://${host}:${port}`);
});

process.once('SIGTERM', () => {
  log('INFO', {event: 'energy_anomaly_detection_shutting_down'});
  server.close(() => process.exit(0));
});
