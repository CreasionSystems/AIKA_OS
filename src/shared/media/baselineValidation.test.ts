import { describe, it, expect } from "vitest";
import { normalizeVideoJobRequest } from "./videoValidation";
import type { VideoCapabilityDescriptor } from "./videoCapability";
import type { VideoDraft, VideoGenerationParams } from "./videoRequest";

/**
 * PR-E: capability 未指定時の baseline 検証 (ADR-001 D6)。
 *
 * capability 未指定そのものは validation error にせず、判定できない検証
 * (モデル固有の値域・組み合わせ・フレーム規則) は黙って省く。
 * 推測値や仮の descriptor は作らない。
 */
const PARAMS: VideoGenerationParams = {
  durationSec: 5,
  fps: 16,
  resolution: "720p",
  qualityPreset: "standard",
  motionStrength: 0.5,
};

function draft(over: Partial<VideoDraft> = {}): VideoDraft {
  return { prompt: "夕暮れの海辺を歩く犬", params: PARAMS, assets: [], ...over };
}

/** 16fps / 4n+1 しか許さない descriptor。 */
const WAN_LIKE: VideoCapabilityDescriptor = {
  allowedFps: [16],
  durationSec: { min: 1, max: 6 },
  frameCount: { kind: "modulo", modulus: 4, remainder: 1, min: 5, max: 81 },
  supportedResolutions: ["480p", "720p"],
  supportedQualityPresets: ["draft", "standard", "high"],
  promptRequirement: "required",
  assetRequirements: [],
  defaults: {
    durationSec: 5,
    fps: 16,
    resolution: "720p",
    qualityPreset: "standard",
    motionStrength: 0.5,
  },
  templateId: "test",
};

function issues(result: ReturnType<typeof normalizeVideoJobRequest>) {
  return result.valid ? [] : result.issues;
}

describe("capability 未指定でも動く baseline 検証", () => {
  it("既定値どおりの下書きは capability なしで通る", () => {
    const result = normalizeVideoJobRequest("t2v", draft());
    expect(result.valid).toBe(true);
  });

  it("capability 未指定そのものは error にしない", () => {
    const result = normalizeVideoJobRequest("t2v", draft());
    expect(issues(result)).toEqual([]);
  });

  it("prompt の必須を kind ごとの baseline で判定する", () => {
    expect(
      issues(normalizeVideoJobRequest("t2v", draft({ prompt: "  " }))).map(
        (i) => i.code,
      ),
    ).toContain("missing-prompt");
    // i2v は baseline では prompt 任意。
    expect(
      normalizeVideoJobRequest(
        "i2v",
        draft({ prompt: "", assets: [{ kind: "image", path: "/a.png" }] }),
      ).valid,
    ).toBe(true);
  });

  it("kind ごとの必須資産を baseline で判定する", () => {
    expect(
      issues(normalizeVideoJobRequest("i2v", draft())).map((i) => i.code),
    ).toContain("asset-count");
  });

  it("数値の形式・下限・NaN を baseline で弾く", () => {
    for (const params of [
      { ...PARAMS, durationSec: 0 },
      { ...PARAMS, durationSec: Number.NaN },
      { ...PARAMS, fps: 0 },
      { ...PARAMS, fps: 16.5 },
      { ...PARAMS, motionStrength: 1.5 },
    ]) {
      expect(normalizeVideoJobRequest("t2v", draft({ params })).valid).toBe(
        false,
      );
    }
  });

  it("列挙値の形式を baseline で弾く", () => {
    const bad = {
      ...PARAMS,
      resolution: "4k" as never,
      qualityPreset: "ultra" as never,
    };
    const codes = issues(
      normalizeVideoJobRequest("t2v", draft({ params: bad })),
    ).map((i) => i.code);
    expect(codes.filter((c) => c === "invalid-parameter")).toHaveLength(2);
  });

  it("秒 x fps が整数フレームにならない場合だけ frame を見る", () => {
    const fractional = { ...PARAMS, durationSec: 5.03 };
    const result = normalizeVideoJobRequest(
      "t2v",
      draft({ params: fractional }),
    );
    const frame = issues(result).find((i) => i.code === "frame-constraint");
    expect(frame).toBeDefined();
    if (frame?.code !== "frame-constraint") return;
    expect(frame.computedFrames).toBeCloseTo(80.48);
    // descriptor が無いので候補は出さない (推測しない)。
    expect(frame.suggestions).toEqual([]);
  });
});

describe("descriptor 固有の検証は capability がある時だけ", () => {
  it("同じ下書きが capability の有無で結果を変える", () => {
    // 5秒 x 16fps = 80 frames は Wan 相当では無効、baseline では有効。
    expect(normalizeVideoJobRequest("t2v", draft()).valid).toBe(true);
    const withCap = normalizeVideoJobRequest("t2v", draft(), WAN_LIKE);
    expect(withCap.valid).toBe(false);
    expect(issues(withCap).map((i) => i.code)).toContain("frame-constraint");
  });

  it("モデル固有の fps 制約は capability がある時だけ効く", () => {
    const params = { ...PARAMS, fps: 24, durationSec: 4 };
    expect(normalizeVideoJobRequest("t2v", draft({ params })).valid).toBe(true);
    expect(
      issues(normalizeVideoJobRequest("t2v", draft({ params }), WAN_LIKE)).some(
        (i) => i.code === "invalid-parameter" && i.field === "fps",
      ),
    ).toBe(true);
  });

  it("capability ありのフレーム候補は descriptor から作る", () => {
    const frame = issues(
      normalizeVideoJobRequest("t2v", draft(), WAN_LIKE),
    ).find((i) => i.code === "frame-constraint");
    if (frame?.code !== "frame-constraint") return;
    expect(frame.suggestions.length).toBeGreaterThan(0);
    expect(frame.suggestions[0]?.frameCount).toBe(81);
  });
});
