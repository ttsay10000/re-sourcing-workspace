export interface AsyncTaskQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  getPendingCount(): number;
  getRunningCount(): number;
}

function normalizeMaxConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export function resolveGeminiOmMaxConcurrency(raw = process.env.GEMINI_OM_MAX_CONCURRENCY): number {
  if (typeof raw !== "string") return 1;
  const parsed = Number(raw.trim());
  return normalizeMaxConcurrency(parsed);
}

export function createAsyncTaskQueue(maxConcurrency: number): AsyncTaskQueue {
  const concurrency = normalizeMaxConcurrency(maxConcurrency);
  let runningCount = 0;
  const pendingTasks: Array<() => void> = [];

  const drain = () => {
    while (runningCount < concurrency && pendingTasks.length > 0) {
      const nextTask = pendingTasks.shift();
      if (!nextTask) break;
      runningCount += 1;
      nextTask();
    }
  };

  return {
    getPendingCount(): number {
      return pendingTasks.length;
    },
    getRunningCount(): number {
      return runningCount;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const execute = () => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              runningCount = Math.max(0, runningCount - 1);
              drain();
            });
        };

        pendingTasks.push(execute);
        drain();
      });
    },
  };
}

const sharedGeminiOmRequestQueue = createAsyncTaskQueue(resolveGeminiOmMaxConcurrency());

export function runWithGeminiOmRequestQueue<T>(task: () => Promise<T>): Promise<T> {
  return sharedGeminiOmRequestQueue.run(task);
}

export function getSharedGeminiOmRequestQueue(): AsyncTaskQueue {
  return sharedGeminiOmRequestQueue;
}
