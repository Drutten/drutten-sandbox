import type {IncomingMessage} from 'node:http';

const pubsubPublishedEvent = 'google.cloud.pubsub.topic.v1.messagePublished';
const maxEventBodyBytes = 1024 * 1024;

interface PubSubEnvelope {
  message?: unknown;
}

interface PubSubMessage {
  data?: unknown;
  attributes?: unknown;
  messageId?: unknown;
  publishTime?: unknown;
}

export interface EnergyImportStagedEvent {
  eventId: string;
  eventType: 'EnergyImportStaged';
  occurredAt: string;
  importId: string;
  bucketName: string;
  objectName: string;
  objectGeneration: string;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
}

export interface EnergyImportStagedDelivery {
  cloudEventId: string;
  pubsubMessageId: string;
  publishTime?: string;
  attributes: Record<string, string>;
  event: EnergyImportStagedEvent;
}

export class InvalidPubSubEventError extends Error {
  override readonly name = 'InvalidPubSubEventError';
  readonly cloudEventId?: string;

  constructor(message: string, cloudEventId?: string, options?: ErrorOptions) {
    super(message, options);
    this.cloudEventId = cloudEventId;
  }
}

export async function parsePubSubEvent(
  request: IncomingMessage,
): Promise<EnergyImportStagedDelivery> {
  const cloudEventId = header(request, 'ce-id');
  const cloudEventType = header(request, 'ce-type');
  if (cloudEventType !== pubsubPublishedEvent || cloudEventId === undefined) {
    throw new InvalidPubSubEventError(
      'Unsupported or malformed CloudEvent',
      cloudEventId,
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    throw new InvalidPubSubEventError(
      'Invalid Pub/Sub event body',
      cloudEventId,
      {cause: error},
    );
  }

  const envelope = objectValue(body, 'Pub/Sub envelope') as PubSubEnvelope;
  const message = objectValue(
    envelope.message,
    'Pub/Sub message',
  ) as PubSubMessage;
  const pubsubMessageId = requiredString(message.messageId, 'messageId');
  const data = requiredString(message.data, 'data');
  const attributes = stringRecord(message.attributes, 'attributes');
  const event = parseDomainEvent(data);

  if (
    attributes.eventId !== undefined &&
    attributes.eventId !== event.eventId
  ) {
    throw new InvalidPubSubEventError(
      'Pub/Sub eventId attribute does not match the event payload',
      cloudEventId,
    );
  }

  return {
    cloudEventId,
    pubsubMessageId,
    publishTime: optionalString(message.publishTime, 'publishTime'),
    attributes,
    event,
  };
}

function parseDomainEvent(encodedData: string): EnergyImportStagedEvent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8'));
  } catch (error) {
    throw new InvalidPubSubEventError(
      'Invalid EnergyImportStaged payload',
      undefined,
      {
        cause: error,
      },
    );
  }

  const event = objectValue(value, 'EnergyImportStaged event');
  if (event.eventType !== 'EnergyImportStaged') {
    throw new InvalidPubSubEventError('Unsupported domain event type');
  }

  return {
    eventId: requiredString(event.eventId, 'eventId'),
    eventType: 'EnergyImportStaged',
    occurredAt: requiredString(event.occurredAt, 'occurredAt'),
    importId: requiredString(event.importId, 'importId'),
    bucketName: requiredString(event.bucketName, 'bucketName'),
    objectName: requiredString(event.objectName, 'objectName'),
    objectGeneration: requiredString(
      event.objectGeneration,
      'objectGeneration',
    ),
    rowCount: nonNegativeInteger(event.rowCount, 'rowCount'),
    validRowCount: nonNegativeInteger(event.validRowCount, 'validRowCount'),
    invalidRowCount: nonNegativeInteger(
      event.invalidRowCount,
      'invalidRowCount',
    ),
  };
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxEventBodyBytes) {
      throw new Error('Event body exceeds 1 MiB');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function objectValue(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidPubSubEventError(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidPubSubEventError(`${fieldName} is required`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, fieldName);
}

function stringRecord(
  value: unknown,
  fieldName: string,
): Record<string, string> {
  if (value === undefined) return {};
  const record = objectValue(value, fieldName);
  for (const item of Object.values(record)) {
    if (typeof item !== 'string') {
      throw new InvalidPubSubEventError(`${fieldName} values must be strings`);
    }
  }
  return record as Record<string, string>;
}

function nonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new InvalidPubSubEventError(
      `${fieldName} must be a non-negative integer`,
    );
  }
  return value;
}
