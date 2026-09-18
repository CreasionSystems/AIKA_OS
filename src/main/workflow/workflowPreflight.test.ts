import { describe, it, expect } from "vitest";
import { createNoopWorkflowPreflight } from "./workflowPreflight";
import type { RoutedWorkflow } from "@shared/inference/port";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";

/**
 * PR-G: 本番の既定 Preflight。
 *
 * 実測に基づかない VRAM 閾値を Dummy に持たせない判断のため、既定は常に
 * 診断なし。診断の分岐はテストで差し替えた実装によって網羅する。
 */
const REQUEST: NormalizedVideoJobRequest = {
  kind: "t2v",
  prompt: "夕暮れの海辺を歩く犬",
  params: {
    durationSec: 81 / 16,
    fps: 16,
    resolution: "720p",
    qualityPreset: "high",
    motionStrength: 0.5,
  },
  assets: [],
};

const WORKFLOW: RoutedWorkflow = {
  templateId: "dummy-t2v",
  inputs: { prompt: REQUEST.prompt },
};

describe("既定 Preflight", () => {
  const preflight = createNoopWorkflowPreflight();

  it("常に空の診断を返す", async () => {
    expect(await preflight.diagnose(REQUEST, WORKFLOW)).toEqual([]);
  });

  it("重い設定でも診断を作らない (架空の閾値を持たない)", async () => {
    const heavy: NormalizedVideoJobRequest = {
      ...REQUEST,
      params: { ...REQUEST.params, fps: 24, qualityPreset: "high" },
    };
    expect(await preflight.diagnose(heavy, WORKFLOW)).toEqual([]);
  });

  it("入力を変更しない", async () => {
    const req = structuredClone(REQUEST);
    const workflow = structuredClone(WORKFLOW);
    await preflight.diagnose(req, workflow);
    expect(req).toEqual(REQUEST);
    expect(workflow).toEqual(WORKFLOW);
  });
});
