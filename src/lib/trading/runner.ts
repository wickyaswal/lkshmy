export class RunnerController {
  private timer: NodeJS.Timeout | null = null;
  private intervalSeconds: number | null = null;

  start(intervalSeconds: number, callback: () => Promise<void>): void {
    this.stop();
    this.intervalSeconds = intervalSeconds;
    this.timer = setInterval(() => {
      void callback();
    }, intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.intervalSeconds = null;
  }

  getState(): { running: boolean; intervalSeconds: number | null } {
    return {
      running: this.timer !== null,
      intervalSeconds: this.intervalSeconds
    };
  }
}

let runner: RunnerController | null = null;

export const getRunnerController = (): RunnerController => {
  if (!runner) {
    runner = new RunnerController();
  }

  return runner;
};
