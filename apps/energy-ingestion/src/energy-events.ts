import {createHash} from 'node:crypto';
import {PubSub} from '@google-cloud/pubsub';

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

export type EnergyImportStagedData = Omit<
  EnergyImportStagedEvent,
  'eventId' | 'eventType' | 'occurredAt'
>;

export function createEnergyImportStagedEvent(
  data: EnergyImportStagedData,
  occurredAt = new Date().toISOString(),
): EnergyImportStagedEvent {
  return {
    eventId: createHash('sha256')
      .update(`EnergyImportStaged|${data.importId}`)
      .digest('hex'),
    eventType: 'EnergyImportStaged',
    occurredAt,
    ...data,
  };
}

export class EnergyEventPublisher {
  private readonly pubsub: PubSub;
  private readonly stagedTopicId: string;

  constructor(pubsub: PubSub, stagedTopicId: string) {
    this.pubsub = pubsub;
    this.stagedTopicId = stagedTopicId;
  }

  async publishImportStaged(
    data: EnergyImportStagedData,
  ): Promise<EnergyImportStagedEvent> {
    const event = createEnergyImportStagedEvent(data);
    await this.pubsub.topic(this.stagedTopicId).publishMessage({
      json: event,
      attributes: {
        eventId: event.eventId,
        eventType: event.eventType,
      },
    });
    return event;
  }
}
