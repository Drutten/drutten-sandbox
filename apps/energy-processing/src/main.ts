import {createServer} from 'node:http';
import {handleStagedEvent} from './handle-staged-event.js';
import {respond} from './http.js';
import {log} from './logging.js';
import {BigQueryStagingRecordReader} from './staging-records.js';
import {BigQueryEnergyRecordMerger} from './energy-record-merger.js';
import {Firestore} from '@google-cloud/firestore';
import {FirestoreImportRunStore} from './import-run-store.js';
import {PubSub} from '@google-cloud/pubsub';
import {EnergyEventPublisher} from './energy-events.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const stagingRecords = new BigQueryStagingRecordReader(
  process.env.ENERGY_DATASET_ID ?? 'energy',
  process.env.GCP_REGION,
);
const energyRecords = new BigQueryEnergyRecordMerger(
  process.env.ENERGY_DATASET_ID ?? 'energy',
  process.env.GCP_REGION,
);
const importRuns = new FirestoreImportRunStore(new Firestore());
const energyImportCompletedTopicId = requiredEnvironmentVariable(
  'ENERGY_IMPORT_COMPLETED_TOPIC_ID',
);
const energyEventPublisher = new EnergyEventPublisher(
  new PubSub(),
  energyImportCompletedTopicId,
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
  void handleStagedEvent(request, response, {
    stagingRecords,
    energyRecords,
    importRuns,
    energyEventPublisher,
    energyImportCompletedTopicId,
  });
});

server.listen(port, host, () => {
  console.log(`energy-processing listening on http://${host}:${port}`);
});

process.once('SIGTERM', () => {
  log('INFO', {event: 'energy_processing_shutting_down'});
  server.close(() => process.exit(0));
});

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
