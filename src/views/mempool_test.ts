import { assertEquals } from "jsr:@std/assert";
import type { MempoolLive, MempoolAverages, MempoolConfig } from "../lib/api.ts";

// Test the null-coalescing logic extracted from the view
function applyDefaults(data: {
  platformVersion?: string;
  live?: MempoolLive;
  averages?: MempoolAverages;
  config: MempoolConfig;
}) {
  const live: MempoolLive = data.live ?? {
    totalSlots: 0, totalBundles: 0, totalWeight: 0, averageBundlesPerSlot: 0,
  };
  const averages: MempoolAverages = data.averages ?? {
    windowMinutes: 60, sampleCount: 0, avgQueueDepth: 0, avgSlotCount: 0,
    avgProcessingMs: 0, avgThroughputPerMin: 0,
  };
  return { platformVersion: data.platformVersion, live, averages, config: data.config };
}

const defaultConfig: MempoolConfig = {
  slotCapacity: 100, expensiveOpWeight: 10, cheapOpWeight: 1,
  executorIntervalMs: 5000, verifierIntervalMs: 10000, ttlCheckIntervalMs: 60000,
};

Deno.test("mempool view: all fields present", () => {
  const result = applyDefaults({
    platformVersion: "0.5.0",
    live: { totalSlots: 2, totalBundles: 5, totalWeight: 10, averageBundlesPerSlot: 2.5 },
    averages: {
      windowMinutes: 60, sampleCount: 10, avgQueueDepth: 1.5, avgSlotCount: 0.8,
      avgProcessingMs: 250, avgThroughputPerMin: 3.2,
    },
    config: defaultConfig,
  });

  assertEquals(result.platformVersion, "0.5.0");
  assertEquals(result.live.totalSlots, 2);
  assertEquals(result.averages.sampleCount, 10);
  assertEquals(result.averages.avgProcessingMs, 250);
});

Deno.test("mempool view: missing live falls back to zeros", () => {
  const result = applyDefaults({ config: defaultConfig });

  assertEquals(result.live.totalSlots, 0);
  assertEquals(result.live.totalBundles, 0);
  assertEquals(result.live.totalWeight, 0);
  assertEquals(result.live.averageBundlesPerSlot, 0);
});

Deno.test("mempool view: missing averages falls back to zeros", () => {
  const result = applyDefaults({ config: defaultConfig });

  assertEquals(result.averages.sampleCount, 0);
  assertEquals(result.averages.avgProcessingMs, 0);
  assertEquals(result.averages.avgThroughputPerMin, 0);
  assertEquals(result.averages.windowMinutes, 60);
});

Deno.test("mempool view: missing platformVersion is undefined", () => {
  const result = applyDefaults({ config: defaultConfig });
  assertEquals(result.platformVersion, undefined);
});
