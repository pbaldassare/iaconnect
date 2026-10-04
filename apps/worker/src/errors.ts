/** A refusal or failure whose message (Italian) is shown to the customer. Never retried. */
export class StepError extends Error {
  constructor(
    message: string,
    public readonly code = "step_error",
  ) {
    super(message);
    this.name = "StepError";
  }
}

/** The resource is held by another worker: release the event or job and try again shortly. */
export class RetryLater extends Error {
  constructor(
    message: string,
    public readonly delayMs = 5_000,
  ) {
    super(message);
    this.name = "RetryLater";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
