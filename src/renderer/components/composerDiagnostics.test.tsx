import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import type { ComposerSubmitOutcome } from "./VideoPromptComposer";
import { acceptingSubmit, blockedSubmit } from "./testSubmit";
import type { RouterDiagnostic } from "@shared/media/routerDiagnostic";
import type {
  NormalizedVideoJobRequest,
  VideoGenerationParams,
} from "@shared/media/videoRequest";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";

/**
 * PR-G: 実行環境の診断 (blocked) の表示と適用。
 *
 * ADR-001 D8: VRAM 不足は入力の不正ではない。error にせず ready のまま提示し、
 * 提案は明示操作でのみ draft に入る。送信は起こさない。
 * D7: 診断の要旨は会話本文、詳細と提案値は live region の外。
 */
afterEach(cleanup);

const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに、ゆっくりズーム";

const SUGGESTED: VideoGenerationParams = {
  durationSec: 81 / 16,
  fps: 16,
  resolution: "480p",
  qualityPreset: "draft",
  motionStrength: 0.5,
};

const LOW_VRAM: RouterDiagnostic = {
  kind: "insufficient-vram",
  requested: {
    durationSec: 5,
    fps: 16,
    resolution: "720p",
    qualityPreset: "standard",
    motionStrength: 0.5,
  },
  suggested: SUGGESTED,
  messageKey: "media.diagnostic.insufficientVram",
};

const MISSING_DEP: RouterDiagnostic = {
  kind: "missing-dependency",
  dependency: "wan2.2-t2v",
  messageKey: "media.diagnostic.missingDependency",
};

const BAD_CONFIG: RouterDiagnostic = {
  kind: "unsupported-configuration",
  messageKey: "media.diagnostic.unsupportedConfiguration",
};

/** 指示 -> まとめる -> ready まで進める。 */
async function toReady(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
  await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
  await screen.findByRole("button", { name: "この内容で送信" });
}

async function send(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "この内容で送信" }));
}

function renderComposer(
  onSubmit: (req: never) => Promise<ComposerSubmitOutcome>,
) {
  return render(
    <VideoPromptComposer
      kind="t2v"
      sourceRequired={false}
      onSubmit={onSubmit as never}
    />,
  );
}

describe("blocked の受け取り", () => {
  it("入力を保持したまま ready に戻り、error にはならない", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    const before = (
      screen.getByLabelText("最終プロンプト案（編集できます）") as
        HTMLTextAreaElement
    ).value;

    await send(user);

    // 再送信できる状態に戻っている。
    expect(
      await screen.findByRole("button", { name: "この内容で送信" }),
    ).toBeEnabled();
    expect(
      screen.getByLabelText("最終プロンプト案（編集できます）"),
    ).toHaveValue(before);
    // 失敗扱いにしない (retry ボタンも alert も出さない)。
    expect(
      screen.queryByRole("button", { name: "再試行" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "送信状態" }),
    ).not.toHaveTextContent("失敗");
  });

  it("構造化パラメータの入力値も保持される", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await user.clear(screen.getByLabelText("長さ（秒）"));
    await user.type(screen.getByLabelText("長さ（秒）"), "4");

    await send(user);

    await screen.findByRole("button", { name: "軽量設定を適用" });
    expect(screen.getByLabelText("長さ（秒）")).toHaveValue(4);
  });

  it("blocked 後にそのまま再送信できる", async () => {
    const onSubmit = blockedSubmit([BAD_CONFIG]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);

    await send(user);
    await screen.findByText("この構成はこの環境では実行できません");
    await send(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
});

describe("診断の表示", () => {
  it("3種の診断をそれぞれ表示できる", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP, LOW_VRAM, BAD_CONFIG]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    const section = await screen.findByRole("region", {
      name: "この環境では実行できません",
    });
    expect(
      within(section).getByText("必要な依存関係が見つかりません"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("この設定を実行するにはメモリが不足しています"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("この構成はこの環境では実行できません"),
    ).toBeInTheDocument();
  });

  it("依存の技術識別子は詳細としてだけ添える", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    const section = await screen.findByRole("region", {
      name: "この環境では実行できません",
    });
    // 本文は翻訳済みの説明。識別子はそれ単独ではなく詳細行に出る。
    expect(
      within(section).getByText("必要な依存関係が見つかりません"),
    ).toBeInTheDocument();
    expect(within(section).getByText("詳細: wan2.2-t2v")).toBeInTheDocument();
  });

  it("表示名を持つ依存はユーザー向けの名前も出す", async () => {
    const named: RouterDiagnostic = {
      ...MISSING_DEP,
      dependencyLabelKey: "media.kind.option.t2v",
    };
    const onSubmit = blockedSubmit([named]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    const section = await screen.findByRole("region", {
      name: "この環境では実行できません",
    });
    expect(
      within(section).getByText("動画: Text to Video"),
    ).toBeInTheDocument();
  });

  it("未知の依存でも翻訳キー欠落やクラッシュを起こさない", async () => {
    const onSubmit = blockedSubmit([
      { ...MISSING_DEP, dependency: "unknown-model-xyz" },
    ]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    const section = await screen.findByRole("region", {
      name: "この環境では実行できません",
    });
    expect(
      within(section).getByText("必要な依存関係が見つかりません"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("詳細: unknown-model-xyz"),
    ).toBeInTheDocument();
  });

  it("診断の要旨を assistant ターンとして一度だけ会話本文に足す", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    const log = await screen.findByRole("log");
    await waitFor(() =>
      expect(
        within(log).getAllByText(
          "必要な依存関係が見つからないため、実行を止めました",
        ),
      ).toHaveLength(1),
    );

    // 別のフィールドを触って再レンダリングしても増えない。
    await user.clear(screen.getByLabelText("長さ（秒）"));
    await user.type(screen.getByLabelText("長さ（秒）"), "4");
    expect(
      within(log).getAllByText(
        "必要な依存関係が見つからないため、実行を止めました",
      ),
    ).toHaveLength(1);
  });
});

describe("診断の a11y", () => {
  it("診断用 live region は初回レンダリングから存在し、名前で一意になる", () => {
    renderComposer(acceptingSubmit());
    const region = screen.getByRole("status", { name: "実行環境の診断" });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("");
    // 送信状態 / コピー結果と混ざらない。
    expect(
      screen.getByRole("status", { name: "送信状態" }),
    ).not.toBe(region);
  });

  it("短い要約だけが live region に入り、詳細は外に置く", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    const region = await screen.findByRole("status", {
      name: "実行環境の診断",
    });
    expect(region).toHaveTextContent("実行できません");
    // 説明文と識別子は live region に入れない。
    expect(region).not.toHaveTextContent("必要な依存関係が見つかりません");
    expect(region).not.toHaveTextContent("wan2.2-t2v");
  });

  it("診断は alert にしない (入力エラーでも処理失敗でもない)", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM, MISSING_DEP]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);

    await screen.findByRole("button", { name: "軽量設定を適用" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("診断の適用ボタンにキーボードだけで到達して操作できる", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    const apply = await screen.findByRole("button", {
      name: "軽量設定を適用",
    });

    apply.focus();
    expect(apply).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("解像度")).toHaveValue("480p");
  });
});

describe("軽量設定の適用", () => {
  it("提案を draft にだけ反映する", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    await user.click(
      await screen.findByRole("button", { name: "軽量設定を適用" }),
    );

    expect(screen.getByLabelText("解像度")).toHaveValue("480p");
    expect(screen.getByLabelText("品質")).toHaveValue("draft");
  });

  it("適用しただけでは送信も再検証も起きない", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.click(
      await screen.findByRole("button", { name: "軽量設定を適用" }),
    );

    // 適用は draft の書き換えだけ。投入は増えない。
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("適用しても診断は消えない (解消したかは次の送信でしか分からない)", async () => {
    const onSubmit = blockedSubmit([LOW_VRAM]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    await user.click(
      await screen.findByRole("button", { name: "軽量設定を適用" }),
    );

    expect(
      screen.getByRole("status", { name: "実行環境の診断" }),
    ).toHaveTextContent("実行できません");
  });

  it("適用後にユーザーが送信すると、その値で投入される", async () => {
    const onSubmit = vi.fn(
      async (
        _req: NormalizedVideoJobRequest,
      ): Promise<ComposerSubmitOutcome> => ({
        status: "blocked",
        diagnostics: [LOW_VRAM],
      }),
    );
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    await user.click(
      await screen.findByRole("button", { name: "軽量設定を適用" }),
    );
    await send(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({
      params: { resolution: "480p", qualityPreset: "draft" },
    });
  });
});

describe("診断と検証指摘の分離", () => {
  const CAPABILITY: VideoCapabilityDescriptor = {
    allowedFps: [8, 16, 24],
    durationSec: { min: 1, max: 8 },
    frameCount: { kind: "modulo", modulus: 4, remainder: 1, min: 5, max: 129 },
    supportedResolutions: ["480p", "720p"],
    supportedQualityPresets: ["draft", "standard", "high"],
    promptRequirement: "required",
    assetRequirements: [],
    defaults: {
      durationSec: 81 / 16,
      fps: 16,
      resolution: "720p",
      qualityPreset: "standard",
      motionStrength: 0.5,
    },
    templateId: "dummy-t2v",
  };

  it("新しい送信を始めると前回の診断が消える", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP]);
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        capability={CAPABILITY}
        onSubmit={onSubmit as never}
      />,
    );
    await toReady(user);
    await send(user);
    await screen.findByText("必要な依存関係が見つかりません");

    // 次は renderer の検証で落ちる要求にする (fps を未設定へ)。
    await user.selectOptions(screen.getByLabelText("fps"), "");
    await send(user);

    // validation 失敗に切り替わり、古い診断は残らない。
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "入力に問題があります",
    );
    expect(
      screen.queryByText("必要な依存関係が見つかりません"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "実行環境の診断" }),
    ).toHaveTextContent("");
  });

  it("送信が成功すれば前回の診断は残らない", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    await screen.findByText("必要な依存関係が見つかりません");

    onSubmit.mockImplementationOnce(async () => ({
      status: "accepted",
      jobId: "job-9",
      completion: Promise.resolve({ status: "succeeded" }),
    }));
    await send(user);

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "送信状態" }),
      ).toHaveTextContent("送信しました"),
    );
    expect(
      screen.queryByText("必要な依存関係が見つかりません"),
    ).not.toBeInTheDocument();
  });

  it("フィールド編集で検証指摘は消えるが、診断は消えない", async () => {
    const onSubmit = blockedSubmit([MISSING_DEP]);
    const user = userEvent.setup();
    renderComposer(onSubmit);
    await toReady(user);
    await send(user);
    await screen.findByText("必要な依存関係が見つかりません");

    await user.clear(screen.getByLabelText("長さ（秒）"));
    await user.type(screen.getByLabelText("長さ（秒）"), "3");

    expect(
      screen.getByText("必要な依存関係が見つかりません"),
    ).toBeInTheDocument();
  });
});
