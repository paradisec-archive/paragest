import { describe, expect, it } from 'vitest';

import { unpackFailure } from './failure-payload';

const stepErrorEvent = {
  bucketName: 'paragest-ingest-prod',
  objectKey: 'incoming/ABC1-001-01.wav',
  principalId: 'AWS:AROAEXAMPLE:abcd1234',
  notes: ['processS3Event: uploaded'],
};

const wrapCause = (errorType: string, errorMessage: unknown) => JSON.stringify({ errorType, errorMessage });

describe('unpackFailure', () => {
  it('reads a StepError carrying its own copy of the event', () => {
    const result = unpackFailure({
      error: {
        Error: 'StepError',
        Cause: wrapCause('StepError', JSON.stringify({ message: 'bad mimetype', event: stepErrorEvent, data: { extension: 'wav' } })),
      },
    });

    expect(result.message).toBe('bad mimetype');
    expect(result.objectKey).toBe('incoming/ABC1-001-01.wav');
    expect(result.principalId).toBe('AWS:AROAEXAMPLE:abcd1234');
    expect(result.data).toEqual({ extension: 'wav' });
  });

  it('falls back to the preserved input when the error is not a StepError', () => {
    const result = unpackFailure({
      ...stepErrorEvent,
      error: { Error: 'Error', Cause: wrapCause('Error', 'Failed to fetch access token: Unexpected token <') },
    });

    expect(result.message).toBe('Failed to fetch access token: Unexpected token <');
    expect(result.objectKey).toBe('incoming/ABC1-001-01.wav');
    expect(result.notes).toEqual(['processS3Event: uploaded']);
  });

  // The crash that stranded 47 files on 2026-09-02: errorMessage was absent, so
  // JSON.parse(undefined) threw before the file could be moved to rejected/
  it('survives a Cause with no errorMessage', () => {
    const result = unpackFailure({ ...stepErrorEvent, error: { Error: 'States.TaskFailed', Cause: JSON.stringify({ Attempts: [] }) } });

    expect(result.objectKey).toBe('incoming/ABC1-001-01.wav');
    expect(result.message).toContain('Attempts');
  });

  it('survives a Cause that is not JSON at all', () => {
    const result = unpackFailure({ ...stepErrorEvent, error: { Error: 'States.Timeout', Cause: 'container killed' } });

    expect(result.message).toBe('container killed');
    expect(result.objectKey).toBe('incoming/ABC1-001-01.wav');
  });

  it('survives an entirely empty payload', () => {
    const result = unpackFailure({});

    expect(result.message).toBe('Unknown error');
    expect(result.objectKey).toBeUndefined();
    expect(result.notes).toEqual([]);
    expect(result.data).toEqual({});
  });

  it('still reads the legacy shape where the catcher replaced the whole input', () => {
    const result = unpackFailure({
      Error: 'StepError',
      Cause: wrapCause('StepError', JSON.stringify({ message: 'item not in database', event: stepErrorEvent, data: {} })),
    });

    expect(result.message).toBe('item not in database');
    expect(result.objectKey).toBe('incoming/ABC1-001-01.wav');
  });
});
