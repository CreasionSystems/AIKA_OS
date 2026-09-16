import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import type {
  PromptRefinementPort,
  RefineResult,
} from "@shared/media/promptRefinement";

/**
 * Step 41-2: 最終ドラフトのコピーボタンの契約テスト。
 *
 * コピーは phase 状態機械から独立したローカル状態として扱う。成功は専用の
 * role="status" (送信用 status とは別)、失敗は role="alert" で伝える。
 * navigator.clipboard は jsdom に存在しないため、テストごとに注入する
 * (グローバルセットアップは変更しない)。
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** navigator.clipboard.writeText を差し替える。 */
function installClipboard(
  writeText: (text: string) => Promise<void>,
): { writeText: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: spy },
  });
  return { writeText: spy };
}

/** 常に ready を返す補完ポート。 */
function readyRefine(): PromptRefinementPort {
  return {
    refine: async (): Promise<RefineResult> => ({
      status: "ready",
      draftPrompt: SUFFICIENT,
      summary: SUFFICIENT,
    }),
  };
}

/** 指示入力 -> ready まで進め、最終案の textarea を返す。 */
async function advanceToReady(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLTextAreaElement> {
  await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
  await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
  return (await screen.findByLabelText(
    "最終プロンプト案（編集できます）",
  )) as HTMLTextAreaElement;
}

function renderComposer(onSubmit = vi.fn(async () => {})) {
  render(
    <VideoPromptComposer
      sourceRequired={false}
      onSubmit={onSubmit}
      refine={readyRefine()}
    />,
  );
  return { onSubmit };
}

describe("Step 41-2: 最終ドラフトのコピー", () => {
  it("コピーボタンを押すと writeText が現在の draft で1回呼ばれる", async () => {
    const user = userEvent.setup();
    const clipboard = installClipboard(async () => {});
    renderComposer();
    await advanceToReady(user);

    await user.click(screen.getByRole("button", { name: "コピー" }));

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(SUFFICIENT);
  });

  it("初期案ではなく編集後の draft をコピーする", async () => {
    const user = userEvent.setup();
    const clipboard = installClipboard(async () => {});
    renderComposer();
    const draft = await advanceToReady(user);

    await user.type(draft, " 10秒");
    await user.click(screen.getByRole("button", { name: "コピー" }));

    expect(clipboard.writeText).toHaveBeenCalledWith(`${SUFFICIENT} 10秒`);
  });

  it("成功すると専用の status でコピー完了を通知する", async () => {
    const user = userEvent.setup();
    installClipboard(async () => {});
    renderComposer();
    await advanceToReady(user);

    // 送信状態とは別の live region が、初回レンダリングから存在する。
    const copyStatus = screen.getByRole("status", { name: "コピー結果" });
    expect(screen.getByRole("status", { name: "送信状態" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "コピー" }));

    await waitFor(() => expect(copyStatus).toHaveTextContent("コピーしました"));
  });

  it("writeText が reject したとき alert を出す", async () => {
    const user = userEvent.setup();
    installClipboard(async () => {
      throw new Error("denied");
    });
    renderComposer();
    await advanceToReady(user);

    await user.click(screen.getByRole("button", { name: "コピー" }));

    const alert = await screen.findByRole("alert", { name: "コピーのエラー" });
    expect(alert).toHaveTextContent("コピーできませんでした");
  });

  it("コピー失敗の文言を送信用 status に混ぜない", async () => {
    const user = userEvent.setup();
    installClipboard(async () => {
      throw new Error("denied");
    });
    renderComposer();
    await advanceToReady(user);

    await user.click(screen.getByRole("button", { name: "コピー" }));
    await screen.findByRole("alert", { name: "コピーのエラー" });

    // 送信状態は ready 文言のままで、コピーの失敗文言を持たない。
    const sendStatus = screen.getByRole("status", { name: "送信状態" });
    expect(sendStatus).toHaveTextContent("プロンプト案ができました");
    expect(sendStatus).not.toHaveTextContent("コピーできませんでした");
  });

  it("draft が空白のみならコピーボタンは disabled", async () => {
    const user = userEvent.setup();
    installClipboard(async () => {});
    renderComposer();
    const draft = await advanceToReady(user);

    await user.clear(draft);
    await user.type(draft, "   ");

    expect(screen.getByRole("button", { name: "コピー" })).toBeDisabled();
  });

  it("コピーボタンは type=button で、押しても送信されない", async () => {
    const user = userEvent.setup();
    installClipboard(async () => {});
    const { onSubmit } = renderComposer();
    await advanceToReady(user);

    const copy = screen.getByRole("button", { name: "コピー" });
    expect(copy).toHaveAttribute("type", "button");

    await user.click(copy);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("コピーしても phase は ready のまま変わらない", async () => {
    const user = userEvent.setup();
    installClipboard(async () => {});
    renderComposer();
    await advanceToReady(user);

    await user.click(screen.getByRole("button", { name: "コピー" }));
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "コピー結果" }),
      ).toHaveTextContent("コピーしました"),
    );

    // 送信状態は ready のまま、送信ボタンも操作可能なまま。
    expect(
      screen.getByRole("status", { name: "送信状態" }),
    ).toHaveTextContent("プロンプト案ができました");
    expect(
      screen.getByRole("button", { name: "この内容で送信" }),
    ).toBeEnabled();
    expect(
      screen.getByLabelText("最終プロンプト案（編集できます）"),
    ).toBeInTheDocument();
  });
});
