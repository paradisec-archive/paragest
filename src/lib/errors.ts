export class StepError extends Error {
  constructor(message: string, event: Record<string, string | number>, data: Record<string, string>) {
    const error = JSON.stringify({
      message,
      event,
      data,
    });
    super(error);
    this.name = 'StepError';
  }
}
