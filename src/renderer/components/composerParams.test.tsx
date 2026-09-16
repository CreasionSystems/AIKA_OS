import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import type {
  PromptRefinementPort,
  RefineResult,
} from "@shared/media/promptRefinement";
import type { VideoKind } from "@shared/inference/port";

/**
 * Step 41-3 / PR-C: 構造化パラメータ UI と資産入力の契約テスト。
 *
 * capability 未指定のため値域の厳密検証は行わない (後続 PR)。
 * ここで固定するのは「入力できること」「保持されること」「種別ごとの出し分け」。
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function readyRefine(): PromptRefinementPort {
  return {
    refine: async (): Promise<RefineResult> => ({
      status: "ready",
      draftPrompt: SUFFICIENT,
      summary: SUFFICIENT,
    }),
  };
}

/** ready ブロックまで進める。 */
async function advanceToReady(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
  await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
  await screen.findByLabelText("最終プロンプト案（編集できます）");
}

function renderComposer(
  kind: VideoKind = "t2v",
  sourceRequired = false,
  onSubmit = vi.fn(async () => {}),
) {
  render(
    <VideoPromptComposer
      kind={kind}
      sourceRequired={sourceRequired}
      onSubmit={onSubmit}
      refine={readyRefine()}
    />,
  );
  return { onSubmit };
}

describe("構造化パラメータの入力", () => {
  it("5項目すべてが label と紐付いて操作できる", async () => {
    const user = userEvent.setup();
    renderComposer();
    await advanceToReady(user);

    expect(screen.getByLabelText("長さ（秒）")).toBeInTheDocument();
    expect(screen.getByLabelText("fps")).toBeInTheDocument();
    expect(screen.getByLabelText("解像度")).toBeInTheDocument();
    expect(screen.getByLabelText("品質")).toBeInTheDocument();
    expect(screen.getByLabelText("モーション強度")).toBeInTheDocument();
  });

  it("既定値は長さ 5 / モーション強度 0.5", async () => {
    const user = userEvent.setup();
    renderComposer();
    await advanceToReady(user);

    expect(screen.getByLabelText("長さ（秒）")).toHaveValue(5);
    expect(screen.getByLabelText("モーション強度")).toHaveValue("0.5");
  });

  it("モーション強度の現在値をテキストでも読める", async () => {
    const user = userEvent.setup();
    renderComposer();
    await advanceToReady(user);

    const slider = screen.getByLabelText("モーション強度");
    const valueId = slider.getAttribute("aria-describedby");
    expect(valueId).not.toBeNull();
    expect(document.getElementById(valueId as string)).toHaveTextContent("0.50");
  });

  it("入力した値が保持される", async () => {
    const user = userEvent.setup();
    renderComposer();
    await advanceToReady(user);

    const fps = screen.getByLabelText("fps");
    await user.clear(fps);
    await user.type(fps, "24");
    await user.selectOptions(screen.getByLabelText("解像度"), "720p");
    await user.selectOptions(screen.getByLabelText("品質"), "high");

    expect(fps).toHaveValue(24);
    expect(screen.getByLabelText("解像度")).toHaveValue("720p");
    expect(screen.getByLabelText("品質")).toHaveValue("high");
  });

  it("数値欄を空にすると未入力として扱い、丸めや補正をしない", async () => {
    const user = userEvent.setup();
    renderComposer();
    await advanceToReady(user);

    const duration = screen.getByLabelText("長さ（秒）");
    await user.clear(duration);
    expect(duration).toHaveValue(null);

    // 範囲外の値も黙って丸めない (検証は capability 接続後)。
    await user.type(duration, "999");
    expect(duration).toHaveValue(999);
  });

  it("送信失敗後もパラメータを保持する", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error("backend down");
    });
    renderComposer("t2v", false, onSubmit);
    await advanceToReady(user);

    const fps = screen.getByLabelText("fps");
    await user.clear(fps);
    await user.type(fps, "16");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "書き直す" }));
    expect(screen.getByLabelText("fps")).toHaveValue(16);
  });
});

describe("種別ごとの資産入力", () => {
  it("t2v は資産入力を出さない", async () => {
    const user = userEvent.setup();
    renderComposer("t2v");
    await advanceToReady(user);

    expect(screen.queryByLabelText("元画像のパス")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("元動画のパス")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("音声ファイルのパス")).not.toBeInTheDocument();
  });

  it("i2v は既存ラベル『元画像のパス』を維持する", async () => {
    const user = userEvent.setup();
    renderComposer("i2v", true);
    await advanceToReady(user);

    const source = screen.getByLabelText("元画像のパス");
    expect(source).toBeInTheDocument();
    // ブラウザ既定の制約検証で submit を止めない。
    expect(source).not.toHaveAttribute("required");
    expect(source).toHaveAttribute("aria-required", "true");
  });

  it("continuation / edit は元動画のパスを出す", async () => {
    for (const kind of ["continuation", "edit"] as const) {
      const user = userEvent.setup();
      renderComposer(kind);
      await advanceToReady(user);
      expect(screen.getByLabelText("元動画のパス")).toBeInTheDocument();
      expect(screen.queryByLabelText("元画像のパス")).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("audio は音声必須 + 画像は任意", async () => {
    const user = userEvent.setup();
    renderComposer("audio");
    await advanceToReady(user);

    expect(screen.getByLabelText("音声ファイルのパス")).toHaveAttribute(
      "aria-required",
      "true",
    );
    expect(screen.getByLabelText("元画像のパス")).toHaveAttribute(
      "aria-required",
      "false",
    );
  });

  it("入力した資産パスが保持され、onSubmit には従来どおり sourceImage で渡す", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    renderComposer("i2v", true, onSubmit);
    await advanceToReady(user);

    await user.type(screen.getByLabelText("元画像のパス"), "/abs/in.png");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    expect(onSubmit).toHaveBeenCalledWith({
      prompt: SUFFICIENT,
      sourceImage: "/abs/in.png",
    });
  });
});
