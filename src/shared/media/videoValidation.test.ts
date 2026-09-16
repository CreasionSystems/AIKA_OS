import { describe, it, expect } from "vitest";
import {
  computeFrameRequest,
  normalizeVideoJobRequest,
  satisfiesFrameRule,
  suggestFrameAlternatives,
  type ValidationIssue,
} from "./videoValidation";
import {
  DEFAULT_ASSET_REQUIREMENTS,
  DEFAULT_PROMPT_REQUIREMENT,
  type FrameCountRule,
  type VideoCapabilityDescriptor,
} from "./videoCapability";
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_MOTION_STRENGTH,
  type LocalMediaAsset,
  type VideoDraft,
  type VideoGenerationParams,
} from "./videoRequest";
import type { VideoKind } from "@shared/inference/port";

/**
 * ADR-001 の共有型契約と正規化・検証の契約テスト。
 *
 * 値域は型にも共通定数にも埋め込まず capability descriptor から引く。
 * 無効値は黙って丸めず、構造化 issue として候補を添えて返す。
 */

/** Wan 2.1 相当 (16fps / 4n+1 フレーム) のテスト用 descriptor。 */
function wanLike(
  kind: VideoKind = "t2v",
  over: Partial<VideoCapabilityDescriptor> = {},
): VideoCapabilityDescriptor {
  return {
    allowedFps: [16],
    durationSec: { min: 1, max: 6 },
    frameCount: { kind: "modulo", modulus: 4, remainder: 1, min: 5, max: 81 },
    supportedResolutions: ["480p", "720p"],
    supportedQualityPresets: ["draft", "standard", "high"],
    promptRequirement: DEFAULT_PROMPT_REQUIREMENT[kind],
    assetRequirements: DEFAULT_ASSET_REQUIREMENTS[kind],
    defaults: {
      durationSec: 5,
      fps: 16,
      resolution: "720p",
      qualityPreset: "standard",
      motionStrength: 0.5,
    },
    templateId: "test",
    ...over,
  };
}

/** LTX-Video 相当 (24/30fps / 8n+1 フレーム)。 */
function ltxLike(kind: VideoKind = "t2v"): VideoCapabilityDescriptor {
  return {
    allowedFps: [24, 30],
    durationSec: { min: 1, max: 20 },
    frameCount: { kind: "modulo", modulus: 8, remainder: 1, min: 9, max: 257 },
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedQualityPresets: ["draft", "standard", "high"],
    promptRequirement: DEFAULT_PROMPT_REQUIREMENT[kind],
    assetRequirements: DEFAULT_ASSET_REQUIREMENTS[kind],
    defaults: {
      durationSec: 5,
      fps: 16,
      resolution: "720p",
      qualityPreset: "standard",
      motionStrength: 0.5,
    },
    templateId: "test",
  };
}

const VALID_PARAMS: VideoGenerationParams = {
  durationSec: 81 / 16,
  fps: 16,
  resolution: "720p",
  qualityPreset: "standard",
  motionStrength: DEFAULT_MOTION_STRENGTH,
};

function draft(over: Partial<VideoDraft> = {}): VideoDraft {
  return {
    prompt: "夕暮れの海辺を歩く犬",
    params: VALID_PARAMS,
    assets: [],
    ...over,
  };
}

function codes(issues: readonly ValidationIssue[]): string[] {
  return issues.map((i) => i.code);
}

function issuesOf(result: ReturnType<typeof normalizeVideoJobRequest>) {
  expect(result.valid).toBe(false);
  return result.valid ? [] : result.issues;
}

describe("正規化: 成功経路", () => {
  it("有効な下書きは送信可能な要求になる (値は補正しない)", () => {
    const result = normalizeVideoJobRequest("t2v", draft(), wanLike());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.request).toEqual({
      kind: "t2v",
      prompt: "夕暮れの海辺を歩く犬",
      params: VALID_PARAMS,
      assets: [],
    });
  });

  it("純粋関数であり、入力を書き換えない", () => {
    const d = draft();
    const snapshot = structuredClone(d);
    normalizeVideoJobRequest("t2v", d, wanLike());
    expect(d).toEqual(snapshot);
  });

  it("Renderer と Main が同じ入力から同じ結果を得る", () => {
    const d = draft();
    const cap = wanLike();
    expect(normalizeVideoJobRequest("t2v", d, cap)).toEqual(
      normalizeVideoJobRequest("t2v", d, cap),
    );
  });
});

describe("パラメータ: 値域は capability から引く", () => {
  it("fps は固定 union ではなく descriptor の allowedFps で判定する", () => {
    // 24fps は LTX 相当では有効、Wan 相当では無効。
    const ltx = normalizeVideoJobRequest(
      "t2v",
      draft({ params: { ...VALID_PARAMS, fps: 24, durationSec: 105 / 24 } }),
      ltxLike(),
    );
    expect(ltx.valid).toBe(true);

    const wan = issuesOf(
      normalizeVideoJobRequest(
        "t2v",
        draft({ params: { ...VALID_PARAMS, fps: 24 } }),
        wanLike(),
      ),
    );
    const fpsIssue = wan.find(
      (i) => i.code === "invalid-parameter" && i.field === "fps",
    );
    expect(fpsIssue).toBeDefined();
    expect(fpsIssue).toMatchObject({ allowed: [16] });
  });

  it("durationSec の上限は共通定数ではなく descriptor が決める", () => {
    const params = { ...VALID_PARAMS, fps: 24, durationSec: 15 };
    // 20秒まで許す descriptor では範囲内。
    const ltx = issuesOf(
      normalizeVideoJobRequest("t2v", draft({ params }), ltxLike()),
    );
    expect(
      ltx.some((i) => i.code === "invalid-parameter" && i.field === "durationSec"),
    ).toBe(false);

    // 6秒までの descriptor では範囲外。
    const wan = issuesOf(
      normalizeVideoJobRequest(
        "t2v",
        draft({ params: { ...VALID_PARAMS, durationSec: 15 } }),
        wanLike(),
      ),
    );
    expect(
      wan.some((i) => i.code === "invalid-parameter" && i.field === "durationSec"),
    ).toBe(true);
  });

  it("既定値は durationSec=5 / motionStrength=0.5", () => {
    expect(DEFAULT_DURATION_SEC).toBe(5);
    expect(DEFAULT_MOTION_STRENGTH).toBe(0.5);
  });

  it("motionStrength は 0.0-1.0 の範囲で検証する", () => {
    for (const value of [-0.1, 1.1, Number.NaN]) {
      const issues = issuesOf(
        normalizeVideoJobRequest(
          "t2v",
          draft({ params: { ...VALID_PARAMS, motionStrength: value } }),
          wanLike(),
        ),
      );
      expect(
        issues.some(
          (i) => i.code === "invalid-parameter" && i.field === "motionStrength",
        ),
      ).toBe(true);
    }
    for (const value of [0, 0.5, 1]) {
      const result = normalizeVideoJobRequest(
        "t2v",
        draft({ params: { ...VALID_PARAMS, motionStrength: value } }),
        wanLike(),
      );
      expect(result.valid).toBe(true);
    }
  });

  it("fps は正の整数のみ受け付ける", () => {
    const issues = issuesOf(
      normalizeVideoJobRequest(
        "t2v",
        draft({ params: { ...VALID_PARAMS, fps: 16.5 } }),
        wanLike(),
      ),
    );
    expect(
      issues.some((i) => i.code === "invalid-parameter" && i.field === "fps"),
    ).toBe(true);
  });

  it("欠けているパラメータを missing-parameter として列挙する", () => {
    const issues = issuesOf(
      normalizeVideoJobRequest(
        "t2v",
        draft({ params: { fps: 16 } }),
        wanLike(),
      ),
    );
    const missing = issues.filter((i) => i.code === "missing-parameter");
    expect(missing).toHaveLength(4);
  });
});

describe("フレーム数制約", () => {
  it("Wan 型 (4n+1) と LTX 型 (8n+1) を共通の規則で表現できる", () => {
    const wan: FrameCountRule = {
      kind: "modulo",
      modulus: 4,
      remainder: 1,
      min: 5,
      max: 81,
    };
    const ltx: FrameCountRule = {
      kind: "modulo",
      modulus: 8,
      remainder: 1,
      min: 9,
      max: 257,
    };
    expect(satisfiesFrameRule(81, wan)).toBe(true);
    expect(satisfiesFrameRule(80, wan)).toBe(false);
    expect(satisfiesFrameRule(257, ltx)).toBe(true);
    expect(satisfiesFrameRule(256, ltx)).toBe(false);
    // 範囲外は満たさない。
    expect(satisfiesFrameRule(85, wan)).toBe(false);
  });

  it("5秒 x 16fps = 80 frames は Wan 型の条件を満たさず、黙って 81 に補正しない", () => {
    const params = { ...VALID_PARAMS, durationSec: 5, fps: 16 };
    const result = normalizeVideoJobRequest("t2v", draft({ params }), wanLike());
    const issues = issuesOf(result);
    const frame = issues.find((i) => i.code === "frame-constraint");

    expect(frame).toBeDefined();
    if (frame?.code !== "frame-constraint") return;

    // 要求値・算出フレーム数・該当制約を構造として持つ。
    expect(frame.requested).toEqual({ durationSec: 5, fps: 16 });
    expect(frame.computedFrames).toBe(80);
    expect(frame.constraint).toEqual({
      kind: "modulo",
      modulus: 4,
      remainder: 1,
      min: 5,
      max: 81,
    });

    // 修正候補を提示するが、結果の値は書き換えていない。
    expect(frame.suggestions.length).toBeGreaterThan(0);
    expect(frame.suggestions[0]).toEqual({
      frameCount: 81,
      fps: 16,
      durationSec: 81 / 16,
    });
    expect(result.valid).toBe(false);
  });

  it("秒と fps の積が整数でない場合も制約違反として扱う", () => {
    const params = { ...VALID_PARAMS, durationSec: 5.03, fps: 16 };
    const issues = issuesOf(
      normalizeVideoJobRequest("t2v", draft({ params }), wanLike()),
    );
    expect(issues.some((i) => i.code === "frame-constraint")).toBe(true);
  });

  it("候補は fps を据え置き、近い有効フレーム数から作る", () => {
    const suggestions = suggestFrameAlternatives(
      computeFrameRequest(5, 16),
      { kind: "modulo", modulus: 4, remainder: 1, min: 5, max: 81 },
    );
    expect(suggestions.map((s) => s.frameCount)).toEqual([81, 77, 73]);
    expect(suggestions.every((s) => s.fps === 16)).toBe(true);
  });

  it("exact / range の規則も表現できる", () => {
    expect(satisfiesFrameRule(25, { kind: "exact", frameCount: 25 })).toBe(true);
    expect(satisfiesFrameRule(26, { kind: "exact", frameCount: 25 })).toBe(false);
    expect(
      satisfiesFrameRule(20, { kind: "range", min: 10, max: 30, step: 5 }),
    ).toBe(true);
    expect(
      satisfiesFrameRule(22, { kind: "range", min: 10, max: 30, step: 5 }),
    ).toBe(false);
  });
});

describe("resolution と qualityPreset は直交する", () => {
  it("480p + high や 720p + draft を型・既定検証では拒否しない", () => {
    for (const [resolution, qualityPreset] of [
      ["480p", "high"],
      ["720p", "draft"],
    ] as const) {
      const result = normalizeVideoJobRequest(
        "t2v",
        draft({ params: { ...VALID_PARAMS, resolution, qualityPreset } }),
        wanLike(),
      );
      expect(result.valid).toBe(true);
    }
  });

  it("実行可能な組み合わせは descriptor の pairs で表現できる", () => {
    const cap = wanLike("t2v", {
      resolutionQualityPairs: [{ resolution: "480p", qualityPreset: "draft" }],
    });
    const issues = issuesOf(
      normalizeVideoJobRequest(
        "t2v",
        draft({
          params: { ...VALID_PARAMS, resolution: "720p", qualityPreset: "high" },
        }),
        cap,
      ),
    );
    expect(codes(issues)).toContain("unsupported-combination");
  });
});

describe("モード別の資産要件", () => {
  const image: LocalMediaAsset = { kind: "image", path: "/abs/in.png" };
  const video: LocalMediaAsset = { kind: "video", path: "/abs/in.mp4" };
  const audio: LocalMediaAsset = { kind: "audio", path: "/abs/in.wav" };

  function check(kind: VideoKind, assets: readonly LocalMediaAsset[]) {
    return normalizeVideoJobRequest(
      kind,
      draft({ assets, params: VALID_PARAMS }),
      wanLike(kind),
    );
  }

  it("t2v は資産なしで通り、資産を渡すと拒否する", () => {
    expect(check("t2v", []).valid).toBe(true);
    expect(check("t2v", [image]).valid).toBe(false);
  });

  it("i2v は image 1個が必須", () => {
    expect(check("i2v", [image]).valid).toBe(true);
    expect(codes(issuesOf(check("i2v", []))))
      .toContain("asset-count");
    expect(codes(issuesOf(check("i2v", [image, image]))))
      .toContain("asset-count");
  });

  it("continuation は video 1個が必須", () => {
    expect(check("continuation", [video]).valid).toBe(true);
    expect(codes(issuesOf(check("continuation", [])))).toContain("asset-count");
  });

  it("edit は video 1個と prompt が必須", () => {
    expect(check("edit", [video]).valid).toBe(true);
    const issues = issuesOf(
      normalizeVideoJobRequest(
        "edit",
        draft({ prompt: "  ", assets: [video] }),
        wanLike("edit"),
      ),
    );
    expect(codes(issues)).toContain("missing-prompt");
  });

  it("audio は audio 1個が必須で、image は共通契約では任意", () => {
    expect(check("audio", [audio]).valid).toBe(true);
    expect(check("audio", [audio, image]).valid).toBe(true);
    expect(codes(issuesOf(check("audio", [image])))).toContain("asset-count");
  });

  it("資産は tuple ではなく配列 + 個数要件で検証する", () => {
    const cap = wanLike("t2v", {
      assetRequirements: [{ kind: "image", min: 1, max: 10 }],
    });
    const many = Array.from({ length: 10 }, () => image);
    expect(
      normalizeVideoJobRequest("t2v", draft({ assets: many }), cap).valid,
    ).toBe(true);
    expect(
      normalizeVideoJobRequest("t2v", draft({ assets: [...many, image] }), cap)
        .valid,
    ).toBe(false);
  });

  it("空パスの資産は invalid-asset として拒否する", () => {
    const issues = issuesOf(check("i2v", [{ kind: "image", path: "  " }]));
    expect(codes(issues)).toContain("invalid-asset");
  });
});

describe("prompt の必須性は descriptor で変更できる", () => {
  it("既定は t2v/edit のみ required", () => {
    expect(DEFAULT_PROMPT_REQUIREMENT).toEqual({
      t2v: "required",
      i2v: "optional",
      continuation: "optional",
      edit: "required",
      audio: "optional",
    });
  });

  it("i2v は prompt 空でも通る", () => {
    const result = normalizeVideoJobRequest(
      "i2v",
      draft({ prompt: "", assets: [{ kind: "image", path: "/abs/in.png" }] }),
      wanLike("i2v"),
    );
    expect(result.valid).toBe(true);
  });

  it("descriptor が forbidden なら prompt を拒否する", () => {
    const issues = issuesOf(
      normalizeVideoJobRequest(
        "i2v",
        draft({ prompt: "犬", assets: [{ kind: "image", path: "/abs/in.png" }] }),
        wanLike("i2v", { promptRequirement: "forbidden" }),
      ),
    );
    expect(codes(issues)).toContain("forbidden-prompt");
  });
});
