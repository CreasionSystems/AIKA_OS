/**
 * 動画生成要求の正規化・検証 (Renderer / Main 共有の純粋関数)。
 *
 * ADR-001 D6: Renderer は入力中の早期フィードバックのために実行し、Main は
 * IPC 境界の最終防衛として同じ関数を再実行する。Renderer の結果は信頼しない。
 *
 * ADR-001 D8: 無効値を黙って丸めない。フレーム数制約に反する場合も自動補正せず、
 * 構造化 issue として要求値・算出フレーム数・該当制約・修正候補を返し、
 * 採用するかはユーザーに委ねる。
 */

import type { VideoKind } from "@shared/inference/port";
import type {
  AssetRequirement,
  FrameCountRule,
  VideoCapabilityDescriptor,
} from "./videoCapability";
import type {
  LocalMediaAsset,
  NormalizedVideoJobRequest,
  QualityPreset,
  Resolution,
  VideoDraft,
  VideoGenerationParams,
} from "./videoRequest";

/** durationSec と fps から導出されるフレーム数。ユーザー入力としては公開しない。 */
export interface FrameRequest {
  durationSec: number;
  fps: number;
  requestedFrameCount: number;
}

/** フレーム制約を満たす代替案。UI が選択肢として提示する (自動適用はしない)。 */
export interface FrameSuggestion {
  durationSec: number;
  fps: number;
  frameCount: number;
}

/** 検証で見つかった問題。UI は messageKey を i18n キーへマップして表示する。 */
export type ValidationIssue =
  | { code: "missing-prompt"; field: "prompt"; messageKey: string }
  | { code: "forbidden-prompt"; field: "prompt"; messageKey: string }
  | { code: "missing-parameter"; field: keyof VideoGenerationParams; messageKey: string }
  | {
      code: "invalid-parameter";
      field: keyof VideoGenerationParams;
      value: unknown;
      /** 離散的な許容値を持つ場合のみ。 */
      allowed?: readonly (number | string)[];
      messageKey: string;
    }
  | {
      /**
       * durationSec x fps がテンプレートの有効フレーム数でない。
       * 単なる文字列エラーにせず、UI が候補を提示できる構造を持つ。
       */
      code: "frame-constraint";
      requested: { durationSec: number; fps: number };
      computedFrames: number;
      constraint: FrameCountRule;
      suggestions: readonly FrameSuggestion[];
      messageKey: string;
    }
  | {
      code: "unsupported-combination";
      resolution: Resolution;
      qualityPreset: QualityPreset;
      messageKey: string;
    }
  | {
      code: "invalid-asset";
      assetKind: LocalMediaAsset["kind"];
      index: number;
      messageKey: string;
    }
  | {
      code: "asset-count";
      requirement: AssetRequirement;
      actual: number;
      messageKey: string;
    }
  | { code: "unsupported-kind"; kind: string; messageKey: string };

export type ValidationResult =
  | { valid: true; request: NormalizedVideoJobRequest }
  | { valid: false; issues: readonly ValidationIssue[] };

const MESSAGE_KEY_PREFIX = "media.validation";

function key(code: string): string {
  return `${MESSAGE_KEY_PREFIX}.${code}`;
}

/** 秒と fps からフレーム数を導出する。丸めは行わない。 */
export function computeFrameRequest(
  durationSec: number,
  fps: number,
): FrameRequest {
  return {
    durationSec,
    fps,
    requestedFrameCount: durationSec * fps,
  };
}

/** フレーム数が規則を満たすか。 */
export function satisfiesFrameRule(
  frameCount: number,
  rule: FrameCountRule,
): boolean {
  if (!Number.isInteger(frameCount) || frameCount <= 0) return false;
  switch (rule.kind) {
    case "exact":
      return frameCount === rule.frameCount;
    case "range": {
      if (frameCount < rule.min || frameCount > rule.max) return false;
      const step = rule.step ?? 1;
      return (frameCount - rule.min) % step === 0;
    }
    case "modulo": {
      if (rule.min !== undefined && frameCount < rule.min) return false;
      if (rule.max !== undefined && frameCount > rule.max) return false;
      return frameCount % rule.modulus === rule.remainder % rule.modulus;
    }
  }
}

/** 規則を満たすフレーム数を小さい順に列挙する (上限つき)。 */
function validFrameCounts(rule: FrameCountRule, limit = 512): number[] {
  const out: number[] = [];
  switch (rule.kind) {
    case "exact":
      out.push(rule.frameCount);
      break;
    case "range": {
      const step = rule.step ?? 1;
      for (let f = rule.min; f <= rule.max && out.length < limit; f += step) {
        out.push(f);
      }
      break;
    }
    case "modulo": {
      const min = rule.min ?? 1;
      const max = rule.max ?? min + rule.modulus * limit;
      for (let f = min; f <= max && out.length < limit; f += 1) {
        if (f % rule.modulus === rule.remainder % rule.modulus) out.push(f);
      }
      break;
    }
  }
  return out;
}

/**
 * 要求フレーム数に近い有効値から代替案を作る。
 * fps は据え置き、durationSec を変えて提示する (自動適用はしない)。
 */
export function suggestFrameAlternatives(
  requested: FrameRequest,
  rule: FrameCountRule,
  max = 3,
): FrameSuggestion[] {
  const { fps, requestedFrameCount } = requested;
  if (!Number.isFinite(fps) || fps <= 0) return [];
  return validFrameCounts(rule)
    .slice()
    .sort(
      (a, b) =>
        Math.abs(a - requestedFrameCount) - Math.abs(b - requestedFrameCount) ||
        a - b,
    )
    .slice(0, max)
    .map((frameCount) => ({
      frameCount,
      fps,
      durationSec: frameCount / fps,
    }));
}

/** 資産の個数要件を検証する。 */
function validateAssets(
  assets: readonly LocalMediaAsset[],
  requirements: readonly AssetRequirement[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validKinds: readonly LocalMediaAsset["kind"][] = [
    "image",
    "video",
    "audio",
  ];

  assets.forEach((asset, index) => {
    if (!validKinds.includes(asset.kind) || asset.path.trim() === "") {
      issues.push({
        code: "invalid-asset",
        assetKind: asset.kind,
        index,
        messageKey: key("invalidAsset"),
      });
    }
  });

  for (const requirement of requirements) {
    const actual = assets.filter((a) => a.kind === requirement.kind).length;
    const tooFew = actual < requirement.min;
    const tooMany = requirement.max !== undefined && actual > requirement.max;
    if (tooFew || tooMany) {
      issues.push({
        code: "asset-count",
        requirement,
        actual,
        messageKey: key("assetCount"),
      });
    }
  }

  // 要件に現れない種別は、そのモードでは受け付けない。
  for (const kind of validKinds) {
    const declared = requirements.some((r) => r.kind === kind);
    const actual = assets.filter((a) => a.kind === kind).length;
    if (!declared && actual > 0) {
      issues.push({
        code: "asset-count",
        requirement: { kind, min: 0, max: 0 },
        actual,
        messageKey: key("assetCount"),
      });
    }
  }

  return issues;
}

/** 数値パラメータの基本検証 (値域は capability 側で見る)。 */
function validateNumericBasics(
  params: VideoGenerationParams,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isFinite(params.durationSec) || params.durationSec <= 0) {
    issues.push({
      code: "invalid-parameter",
      field: "durationSec",
      value: params.durationSec,
      messageKey: key("invalidDuration"),
    });
  }
  if (!Number.isInteger(params.fps) || params.fps <= 0) {
    issues.push({
      code: "invalid-parameter",
      field: "fps",
      value: params.fps,
      messageKey: key("invalidFps"),
    });
  }
  if (
    !Number.isFinite(params.motionStrength) ||
    params.motionStrength < 0 ||
    params.motionStrength > 1
  ) {
    issues.push({
      code: "invalid-parameter",
      field: "motionStrength",
      value: params.motionStrength,
      messageKey: key("invalidMotionStrength"),
    });
  }

  return issues;
}

/** capability の値域に対する検証。 */
function validateAgainstCapability(
  params: VideoGenerationParams,
  capability: VideoCapabilityDescriptor,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!capability.allowedFps.includes(params.fps)) {
    issues.push({
      code: "invalid-parameter",
      field: "fps",
      value: params.fps,
      allowed: capability.allowedFps,
      messageKey: key("fpsNotAllowed"),
    });
  }

  const { min, max, allowed } = capability.durationSec;
  const outOfRange = params.durationSec < min || params.durationSec > max;
  const notAllowed = allowed !== undefined && !allowed.includes(params.durationSec);
  if (outOfRange || notAllowed) {
    issues.push({
      code: "invalid-parameter",
      field: "durationSec",
      value: params.durationSec,
      ...(allowed !== undefined ? { allowed } : {}),
      messageKey: key("durationNotAllowed"),
    });
  }

  if (!capability.supportedResolutions.includes(params.resolution)) {
    issues.push({
      code: "invalid-parameter",
      field: "resolution",
      value: params.resolution,
      allowed: capability.supportedResolutions,
      messageKey: key("resolutionNotSupported"),
    });
  }

  if (!capability.supportedQualityPresets.includes(params.qualityPreset)) {
    issues.push({
      code: "invalid-parameter",
      field: "qualityPreset",
      value: params.qualityPreset,
      allowed: capability.supportedQualityPresets,
      messageKey: key("qualityNotSupported"),
    });
  }

  // 解像度と品質は直交させたうえで、組み合わせの実行可能性のみ descriptor で見る。
  const pairs = capability.resolutionQualityPairs;
  if (
    pairs !== undefined &&
    !pairs.some(
      (p) =>
        p.resolution === params.resolution &&
        p.qualityPreset === params.qualityPreset,
    )
  ) {
    issues.push({
      code: "unsupported-combination",
      resolution: params.resolution,
      qualityPreset: params.qualityPreset,
      messageKey: key("unsupportedCombination"),
    });
  }

  return issues;
}

/** VideoGenerationParams として欠けている項目を列挙する。 */
function missingParams(
  params: Partial<VideoGenerationParams>,
): ValidationIssue[] {
  const fields: (keyof VideoGenerationParams)[] = [
    "durationSec",
    "fps",
    "resolution",
    "qualityPreset",
    "motionStrength",
  ];
  return fields
    .filter((f) => params[f] === undefined)
    .map((field) => ({
      code: "missing-parameter" as const,
      field,
      messageKey: key("missingParameter"),
    }));
}

/**
 * 下書きを検証し、通れば送信可能な要求を返す。
 *
 * 副作用なしの純粋関数。Renderer と Main の双方がこれを実行する。
 * 値を補正しないため、戻り値の request は入力と同じ値を持つ。
 */
export function normalizeVideoJobRequest(
  kind: VideoKind,
  draft: VideoDraft,
  capability: VideoCapabilityDescriptor,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const prompt = draft.prompt.trim();

  if (capability.promptRequirement === "required" && prompt === "") {
    issues.push({
      code: "missing-prompt",
      field: "prompt",
      messageKey: key("missingPrompt"),
    });
  }
  if (capability.promptRequirement === "forbidden" && prompt !== "") {
    issues.push({
      code: "forbidden-prompt",
      field: "prompt",
      messageKey: key("forbiddenPrompt"),
    });
  }

  issues.push(...validateAssets(draft.assets, capability.assetRequirements));

  const missing = missingParams(draft.params);
  issues.push(...missing);

  if (missing.length > 0) {
    return { valid: false, issues };
  }

  const params = draft.params as VideoGenerationParams;
  const basics = validateNumericBasics(params);
  issues.push(...basics);
  issues.push(...validateAgainstCapability(params, capability));

  // 基本検証を通った場合のみフレーム制約を見る (NaN などで無意味な候補を出さない)。
  if (basics.length === 0) {
    const frames = computeFrameRequest(params.durationSec, params.fps);
    if (!satisfiesFrameRule(frames.requestedFrameCount, capability.frameCount)) {
      issues.push({
        code: "frame-constraint",
        requested: { durationSec: params.durationSec, fps: params.fps },
        computedFrames: frames.requestedFrameCount,
        constraint: capability.frameCount,
        suggestions: suggestFrameAlternatives(frames, capability.frameCount),
        messageKey: key("frameConstraint"),
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    request: {
      kind,
      prompt,
      params,
      assets: draft.assets,
    },
  };
}
