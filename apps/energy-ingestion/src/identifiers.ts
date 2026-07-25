import { createHash } from 'node:crypto';

function sha256(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function createImportId(
  bucket: string,
  fileName: string,
  generation: string,
): string {
  return sha256([bucket, fileName, generation]);
}

export function createRecordId(
  meterId: string,
  periodStart: string,
  periodEnd: string,
): string {
  const identity = [meterId, periodStart, periodEnd].map((part) => part.trim());

  if (identity.some((part) => part.length === 0)) {
    throw new Error('Cannot create record ID from empty identity fields');
  }

  return sha256(identity);
}
