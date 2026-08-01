import {createServer} from 'node:http';
import {BigQuery} from '@google-cloud/bigquery';
import {Firestore} from '@google-cloud/firestore';
import {PubSub} from '@google-cloud/pubsub';
import {Storage} from '@google-cloud/storage';
import {EnergyEventPublisher} from './energy-events.js';
import {respond} from './http.js';
import {ImportRunStore} from './import-run-store.js';
import {handleStorageEvent} from './handle-storage-event.js';
import {log} from './logging.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const region = requiredEnvironmentVariable('GCP_REGION');
const energyDatasetId = requiredEnvironmentVariable('ENERGY_DATASET_ID');
const energyImportStagedTopicId = requiredEnvironmentVariable(
  'ENERGY_IMPORT_STAGED_TOPIC_ID',
);

const dependencies = {
  storage: new Storage(),
  bigquery: new BigQuery(),
  importRunStore: new ImportRunStore(new Firestore()),
  energyEventPublisher: new EnergyEventPublisher(
    new PubSub(),
    energyImportStagedTopicId,
  ),
  region,
  energyDatasetId,
  energyImportStagedTopicId,
  maxCsvFileSizeBytes: positiveIntegerEnvironmentVariable(
    'MAX_CSV_FILE_SIZE_BYTES',
  ),
};

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    respond(response, 200, {status: 'ok'});
    return;
  }
  if (request.method !== 'POST') {
    respond(response, 405, {error: 'Method not allowed'});
    return;
  }
  void handleStorageEvent(request, response, dependencies);
});

server.listen(port, host, () => {
  console.log(`energy-ingestion listening on http://${host}:${port}`);
});

process.once('SIGTERM', () => {
  log('INFO', {event: 'energy_ingestion_shutting_down'});
  server.close(() => process.exit(0));
});

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function positiveIntegerEnvironmentVariable(name: string): number {
  const value = process.env[name];
  const parsed = Number(value);
  if (
    value === undefined ||
    value.length === 0 ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
