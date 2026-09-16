type CaughtError = {
  Error?: string;
  Cause?: string;
};

// The state machine's catcher preserves the original input alongside `error`, so the
// object key survives even when the failure wasn't a StepError carrying its own copy
export type FailureEvent = CaughtError & {
  error?: CaughtError;
  bucketName?: string;
  objectKey?: string;
  principalId?: string;
  notes?: string[];
};

type StepErrorPayload = {
  message: string;
  event: { bucketName: string; objectKey: string; principalId: string; notes: string[] };
  data: Record<string, unknown>;
};

const parseJson = <T>(value: unknown): T | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

// Every layer here is optional: an unexpected crash (a container OOM, a failed module
// import) produces none of the StepError structure, and losing the object key is what
// strands a file in incoming/
export const unpackFailure = (event: FailureEvent) => {
  const caught = event.error ?? event;
  const cause = parseJson<{ errorType?: string; errorMessage?: string }>(caught.Cause);
  const stepError = parseJson<StepErrorPayload>(cause?.errorMessage);

  return {
    message: stepError?.message ?? cause?.errorMessage ?? caught.Cause ?? caught.Error ?? 'Unknown error',
    data: stepError?.data ?? {},
    bucketName: stepError?.event?.bucketName ?? event.bucketName,
    objectKey: stepError?.event?.objectKey ?? event.objectKey,
    principalId: stepError?.event?.principalId ?? event.principalId ?? '',
    notes: stepError?.event?.notes ?? event.notes ?? [],
  };
};
