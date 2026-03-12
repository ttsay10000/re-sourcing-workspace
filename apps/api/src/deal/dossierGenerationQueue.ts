import { createAsyncTaskQueue } from "../asyncTaskQueue.js";

const dossierGenerationQueue = createAsyncTaskQueue(1);

export function runWithDossierGenerationQueue<T>(task: () => Promise<T>): Promise<T> {
  return dossierGenerationQueue.run(task);
}

export function getDossierGenerationQueue() {
  return dossierGenerationQueue;
}
