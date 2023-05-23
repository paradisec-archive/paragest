export class StepError extends Error {
  constructor(message: string, principalId: string, data: Record<string, string>) {
    const error = JSON.stringify({ message, principalId, data });
    super(error);
    this.name = 'StepError';
  }
}
