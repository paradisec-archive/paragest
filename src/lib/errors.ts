export class StepError extends Error {
  constructor(message: string, event: Record<string, string | number | object>, data: Record<string, string | number | object | undefined>) {
    const error = JSON.stringify({
      message,
      event,
      data,
    });
    super(error);
    this.name = 'StepError';
  }
}
