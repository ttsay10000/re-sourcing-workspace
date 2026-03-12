import { describe, expect, it } from "vitest";
import { createAsyncTaskQueue, resolveGeminiOmMaxConcurrency } from "./asyncTaskQueue.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("asyncTaskQueue", () => {
  it("runs queued tasks one after another when concurrency is 1", async () => {
    const queue = createAsyncTaskQueue(1);
    const events: string[] = [];
    let running = 0;
    let maxRunning = 0;

    const runTask = (label: string, ms: number) =>
      queue.run(async () => {
        events.push(`start:${label}`);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await sleep(ms);
        running -= 1;
        events.push(`end:${label}`);
        return label;
      });

    const results = await Promise.all([
      runTask("a", 20),
      runTask("b", 1),
      runTask("c", 1),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    expect(events).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
  });

  it("normalizes invalid concurrency values back to 1", () => {
    expect(resolveGeminiOmMaxConcurrency("0")).toBe(1);
    expect(resolveGeminiOmMaxConcurrency("-3")).toBe(1);
    expect(resolveGeminiOmMaxConcurrency("not-a-number")).toBe(1);
  });
});
