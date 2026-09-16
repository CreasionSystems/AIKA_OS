import { describe, it, expect } from "vitest";
import { createDummyCapabilityProvider } from "./videoCapabilities";
import { normalizeVideoJobRequest } from "@shared/media/videoValidation";
import {
  DEFAULT_ASSET_REQUIREMENTS,
  DEFAULT_PROMPT_REQUIREMENT,
} from "@shared/media/videoCapability";
import type { VideoKind } from "@shared/inference/port";

/**
 * PR-F1: 能力記述の供給 (main 側)。
 *
 * ADR-001 D2: renderer へ渡すのは「何が選べるか」だけ。
 * D8: defaults は提示であって補完ではない。
 */
const KINDS: readonly VideoKind[] = [
  "t2v",
  "i2v",
  "continuation",
  "edit",
  "audio",
];

describe("createDummyCapabilityProvider", () => {
  const provider = createDummyCapabilityProvider();

  it("全 kind に descriptor を返す", () => {
    for (const kind of KINDS) {
      expect(provider.capabilityFor(kind)).not.toBeNull();
    }
  });

  it("kind ごとの prompt / 資産要件は baseline と一致する", () => {
    for (const kind of KINDS) {
      const cap = provider.capabilityFor(kind);
      expect(cap?.promptRequirement).toBe(DEFAULT_PROMPT_REQUIREMENT[kind]);
      expect(cap?.assetRequirements).toEqual(DEFAULT_ASSET_REQUIREMENTS[kind]);
    }
  });

  it("templateId は kind ごとに異なる内部識別子", () => {
    const ids = KINDS.map((k) => provider.capabilityFor(k)?.templateId);
    expect(new Set(ids).size).toBe(KINDS.length);
  });

  it("defaults 自体が自分の制約を満たす", () => {
    for (const kind of KINDS) {
      const cap = provider.capabilityFor(kind);
      if (cap === null) continue;
      expect(cap.allowedFps).toContain(cap.defaults.fps);
      expect(cap.supportedResolutions).toContain(cap.defaults.resolution);
      expect(cap.supportedQualityPresets).toContain(cap.defaults.qualityPreset);
      expect(cap.defaults.durationSec).toBeGreaterThanOrEqual(
        cap.durationSec.min,
      );
      expect(cap.defaults.durationSec).toBeLessThanOrEqual(cap.durationSec.max);
    }
  });

  it("defaults で作った要求は検証を通る (提示値がそのまま使える)", () => {
    const cap = provider.capabilityFor("t2v");
    if (cap === null) return;
    const result = normalizeVideoJobRequest(
      "t2v",
      { prompt: "夕暮れの海辺を歩く犬", params: cap.defaults, assets: [] },
      cap,
    );
    expect(result.valid).toBe(true);
  });

  it("frame 制約を持つ (descriptor 由来の検証が動く)", () => {
    const cap = provider.capabilityFor("t2v");
    expect(cap?.frameCount).toEqual({
      kind: "modulo",
      modulus: 4,
      remainder: 1,
      min: 5,
      max: 129,
    });
  });
});
