declare namespace NodeJS {
  interface ProcessEnv {
    readonly STATE_MACHINE_ARN: string | undefined;
    readonly PARAGEST_ENV: string | undefined;
  }
}
