import {createHash} from 'node:crypto';
import {PubSub} from '@google-cloud/pubsub';

export interface EnergyImportCompletedEvent {
  eventId: string;
  eventType: 'EnergyImportCompleted';
  occurredAt: string;
  importId: string;
  stagedEventId: string;
  mergeJobId: string;
  bucketName: string;
  objectName: string;
  objectGeneration: string;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
}

export type EnergyImportCompletedData = Omit<
  EnergyImportCompletedEvent,
  'eventId' | 'eventType' | 'occurredAt'
>;

export function createEnergyImportCompletedEvent(
  data: EnergyImportCompletedData,
  occurredAt = new Date().toISOString(),
): EnergyImportCompletedEvent {
  return {
    eventId: createHash('sha256')
      .update(`EnergyImportCompleted|${data.importId}`)
      .digest('hex'),
    eventType: 'EnergyImportCompleted',
    occurredAt,
    ...data,
  };
}

export interface CompletedEventPublisher {
  publishImportCompleted(
    data: EnergyImportCompletedData,
  ): Promise<{event: EnergyImportCompletedEvent; messageId: string}>;
}

export class EnergyEventPublisher implements CompletedEventPublisher {
  private readonly pubsub: PubSub;
  private readonly completedTopicId: string;

  constructor(pubsub: PubSub, completedTopicId: string) {
    this.pubsub = pubsub;
    this.completedTopicId = completedTopicId;
  }

  async publishImportCompleted(
    data: EnergyImportCompletedData,
  ): Promise<{event: EnergyImportCompletedEvent; messageId: string}> {
    const event = createEnergyImportCompletedEvent(data);
    const messageId = await this.pubsub
      .topic(this.completedTopicId)
      .publishMessage({
        json: event,
        attributes: {
          eventId: event.eventId,
          eventType: event.eventType,
        },
      });
    return {event, messageId};
  }
}
