import { describe, it, expect } from "vitest";
import { createDummyWorkflowRouter } from "./workflowRouter";
import { descriptorFor } from "./videoTemplates";
import type { VideoKind } from "@shared/inference/port";
import type {
  LocalMediaAsset,
  NormalizedVideoJobRequest,
  VideoGenerationParams,
} from "@shared/media/videoRequest";

/**
 * PR-F2: Workflow Router (実行向けの「何を注入するか」)。
 *
 * ADR-001 D8: Router は値を補完・変換・書き換えしない。ユーザーが画面で
 * 確認した値を、そのまま inputs へ移すだけ。
 */
const KINDS: readonly VideoKind[] = [
  "t2v",
  "i2v",
  "continuation",
  "edit",
  "audio",
];

const PARAMS: VideoGenerationParams = {
  durationSec: 81 / 16,
  fps: 16,
  resolution: "480p",
  qualityPreset: "high",
  motionStrength: 0.25,
};

const IMAGE: LocalMediaAsset = { kind: "image", path: "/abs/in.png" };
const AUDIO: LocalMediaAsset = { kind: "audio", path: "/abs/in.wav" };
const VIDEO: LocalMediaAsset = { kind: "video", path: "/abs/in.mp4" };

function request(
  over: Partial<NormalizedVideoJobRequest> = {},
): NormalizedVideoJobRequest {
  return {
    kind: "t2v",
    prompt: "夕暮れの海辺を歩く犬",
    params: PARAMS,
    assets: [],
    ...over,
  };
}

describe("テンプレート選択", () => {
  const router = createDummyWorkflowRouter();

  it("kind ごとに期待する templateId へ route される", () => {
    for (const kind of KINDS) {
      const routed = router.route(request({ kind }));
      expect(routed?.templateId).toBe(descriptorFor(kind)?.templateId);
    }
  });

  it("kind ごとに異なる templateId になる", () => {
    const ids = KINDS.map((kind) => router.route(request({ kind }))?.templateId);
    expect(new Set(ids).size).toBe(KINDS.length);
  });

  it("対応テンプレートが無ければ null を返す (例外にしない)", () => {
    // descriptorFor が null を返す状況を模した Router。
    const empty = {
      route: (req: NormalizedVideoJobRequest) =>
        req.kind === "audio" ? null : createDummyWorkflowRouter().route(req),
    };
    expect(empty.route(request({ kind: "audio" }))).toBeNull();
  });
});

describe("パラメータの注入", () => {
  const router = createDummyWorkflowRouter();

  it("5項目すべてが inputs に同値で残る", () => {
    const routed = router.route(request());
    expect(routed?.inputs).toMatchObject({
      durationSec: PARAMS.durationSec,
      fps: PARAMS.fps,
      resolution: PARAMS.resolution,
      qualityPreset: PARAMS.qualityPreset,
      motionStrength: PARAMS.motionStrength,
    });
  });

  it("prompt も inputs に残る", () => {
    const routed = router.route(request({ prompt: "夜の街を走る車" }));
    expect(routed?.inputs.prompt).toBe("夜の街を走る車");
  });

  it("image asset と 非 image asset の両方が inputs に残る", () => {
    const assets = [IMAGE, AUDIO, VIDEO];
    const routed = router.route(request({ kind: "audio", assets }));
    expect(routed?.inputs.assets).toEqual(assets);
  });

  it("image 以外だけでも落とさない", () => {
    const routed = router.route(request({ kind: "continuation", assets: [VIDEO] }));
    expect(routed?.inputs.assets).toEqual([VIDEO]);
  });

  it("資産が無ければ空配列のまま", () => {
    expect(router.route(request())?.inputs.assets).toEqual([]);
  });
});

describe("値を書き換えない", () => {
  const router = createDummyWorkflowRouter();

  it("入力オブジェクトを変更しない", () => {
    const req = request({ assets: [IMAGE] });
    const snapshot = structuredClone(req);
    router.route(req);
    expect(req).toEqual(snapshot);
  });

  it("丸め・補完・既定値の差し込みをしない", () => {
    // descriptor の defaults とは異なる値を渡しても、そのまま出る。
    const odd: VideoGenerationParams = {
      durationSec: 3,
      fps: 8,
      resolution: "480p",
      qualityPreset: "draft",
      motionStrength: 0,
    };
    const routed = router.route(request({ params: odd }));
    expect(routed?.inputs).toMatchObject({
      durationSec: 3,
      fps: 8,
      resolution: "480p",
      qualityPreset: "draft",
      motionStrength: 0,
    });
  });

  it("同じ入力から常に同じ出力を返す", () => {
    const req = request({ assets: [IMAGE, AUDIO] });
    expect(router.route(req)).toEqual(router.route(req));
  });
});
