import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import { acceptingSubmit } from "./testSubmit";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import {
  DEFAULT_ASSET_REQUIREMENTS,
  DEFAULT_PROMPT_REQUIREMENT,
} from "@shared/media/videoCapability";

/**
 * PR-F1: capability が供給されたときのコンポーザの振る舞い。
 *
 * - 初期値は descriptor の defaults を使う (未取得時は fallback)
 * - 選択肢は capability で絞る
 * - descriptor 由来の検証 (frame 制約) が実際に動く
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 16fps / 4n+1 フレーム。480p のみ。draft/standard のみ。 */
const CAPABILITY: VideoCapabilityDescriptor = {
  allowedFps: [8, 16],
  durationSec: { min: 1, max: 8 },
  frameCount: { kind: "modulo", modulus: 4, remainder: 1, min: 5, max: 129 },
  supportedResolutions: ["480p"],
  supportedQualityPresets: ["draft", "standard"],
  promptRequirement: DEFAULT_PROMPT_REQUIREMENT.t2v,
  assetRequirements: DEFAULT_ASSET_REQUIREMENTS.t2v,
  defaults: {
    durationSec: 81 / 16,
    fps: 16,
    resolution: "480p",
    qualityPreset: "draft",
    motionStrength: 0.25,
  },
  templateId: "test-t2v",
};

function renderComposer(capability?: VideoCapabilityDescriptor) {
  const onSubmit = acceptingSubmit();
  render(
    <VideoPromptComposer
      kind="t2v"
      sourceRequired={false}
      onSubmit={onSubmit}
      {...(capability !== undefined ? { capability } : {})}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

async function toReady(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
  await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
  await screen.findByLabelText("最終プロンプト案（編集できます）");
}

describe("capability 由来の初期値", () => {
  it("capability があれば defaults を初期値に使う", async () => {
    const { user } = renderComposer(CAPABILITY);
    await toReady(user);

    expect(screen.getByLabelText("解像度")).toHaveValue("480p");
    expect(screen.getByLabelText("品質")).toHaveValue("draft");
    expect(screen.getByLabelText("モーション強度")).toHaveValue("0.25");
  });

  it("capability が無ければ fallback の初期値で立つ", async () => {
    const { user } = renderComposer();
    await toReady(user);

    expect(screen.getByLabelText("長さ（秒）")).toHaveValue(5);
    expect(screen.getByLabelText("解像度")).toHaveValue("720p");
    expect(screen.getByLabelText("品質")).toHaveValue("standard");
  });

  it("ユーザーが編集した後は capability が届いても上書きしない", async () => {
    const { user } = renderComposer(CAPABILITY);
    await toReady(user);

    await user.selectOptions(screen.getByLabelText("品質"), "standard");
    expect(screen.getByLabelText("品質")).toHaveValue("standard");
    // ドラフト提示後は capability-defaults-applied が効かない。
    expect(screen.getByLabelText("品質")).not.toHaveValue("draft");
  });
});

describe("選択肢の絞り込み", () => {
  it("解像度・品質は capability の対応値だけを出す", async () => {
    const { user } = renderComposer(CAPABILITY);
    await toReady(user);

    const resolution = screen.getByLabelText("解像度");
    expect(within(resolution).getByRole("option", { name: "480p" })).toBeInTheDocument();
    expect(within(resolution).queryByRole("option", { name: "720p" })).toBeNull();
    expect(within(resolution).queryByRole("option", { name: "1080p" })).toBeNull();

    const quality = screen.getByLabelText("品質");
    expect(within(quality).queryByRole("option", { name: "高品質" })).toBeNull();
  });

  it("fps は許容値の選択肢になる (capability 未指定では数値入力)", async () => {
    const { user } = renderComposer(CAPABILITY);
    await toReady(user);

    const fps = screen.getByLabelText("fps");
    expect(fps.tagName).toBe("SELECT");
    expect(within(fps).getByRole("option", { name: "8" })).toBeInTheDocument();
    expect(within(fps).getByRole("option", { name: "16" })).toBeInTheDocument();
    expect(within(fps).queryByRole("option", { name: "24" })).toBeNull();

    cleanup();
    const plain = renderComposer();
    await toReady(plain.user);
    expect(screen.getByLabelText("fps").tagName).toBe("INPUT");
  });
});

describe("descriptor 由来の検証が動く (PR-E で dormant だった経路)", () => {
  it("frame 制約に反する組み合わせを送信すると候補が出る", async () => {
    const { onSubmit, user } = renderComposer(CAPABILITY);
    await toReady(user);

    // 5秒 x 16fps = 80 frames は 4n+1 を満たさない。
    const duration = screen.getByLabelText("長さ（秒）");
    await user.clear(duration);
    await user.type(duration, "5");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    // IPC へは行かない (renderer の事前検証で止まる)。
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    const panel = screen.getByRole("region", { name: "長さの候補" });
    expect(
      within(panel).getAllByRole("button", { name: "この長さにする" }).length,
    ).toBeGreaterThan(0);
  });

  it("候補を適用すると長さが変わり、送信できるようになる", async () => {
    const { onSubmit, user } = renderComposer(CAPABILITY);
    await toReady(user);

    const duration = screen.getByLabelText("長さ（秒）");
    await user.clear(duration);
    await user.type(duration, "5");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));
    const panel = await screen.findByRole("region", { name: "長さの候補" });

    // 自動適用はしない。ユーザーが押して初めて変わる。
    expect(duration).toHaveValue(5);
    await user.click(
      within(panel).getAllByRole("button", { name: "この長さにする" })[0]!,
    );
    expect(duration).toHaveValue(81 / 16);

    await user.click(screen.getByRole("button", { name: "この内容で送信" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("capability が無ければ同じ組み合わせでも frame 制約は出ない", async () => {
    const { onSubmit, user } = renderComposer();
    await toReady(user);

    const duration = screen.getByLabelText("長さ（秒）");
    await user.clear(duration);
    await user.type(duration, "5");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "長さの候補" })).toBeNull();
  });
});
