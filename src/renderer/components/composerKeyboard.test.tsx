import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  createEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import type {
  PromptRefinementPort,
  RefineResult,
} from "@shared/media/promptRefinement";

/**
 * Step 41-1: Enter 送信 / Shift+Enter 改行 / IME 変換確定中の誤送信防止 /
 * submit 経路の一本化 の契約テスト。
 *
 * jsdom は IME を持たないため isComposing / keyCode は自然には発生しない。
 * 通常操作は user-event、IME 固有のネイティブプロパティ検証は createEvent +
 * defineProperty で KeyboardEvent を組み立てて検証する。
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** IME 状態を差し込んだ keydown を dispatch する。 */
function fireImeKeyDown(
  element: HTMLElement,
  options: {
    key?: string;
    isComposing?: boolean;
    keyCode?: number;
    shiftKey?: boolean;
  } = {},
): void {
  const event = createEvent.keyDown(element, {
    key: options.key ?? "Enter",
    code: options.key ?? "Enter",
    shiftKey: options.shiftKey ?? false,
  });
  // isComposing / keyCode は読み取り専用のため生成後に差し込む。
  Object.defineProperty(event, "isComposing", {
    configurable: true,
    value: options.isComposing ?? false,
  });
  Object.defineProperty(event, "keyCode", {
    configurable: true,
    value: options.keyCode ?? 13,
  });
  fireEvent(element, event);
}

/** 呼び出し回数を数えられる補完ポート。 */
function countingRefine(result?: RefineResult): {
  port: PromptRefinementPort;
  calls: () => number;
} {
  let calls = 0;
  return {
    port: {
      refine: async () => {
        calls += 1;
        return (
          result ?? {
            status: "ready",
            draftPrompt: SUFFICIENT,
            summary: SUFFICIENT,
          }
        );
      },
    },
    calls: () => calls,
  };
}

/** 決して解決しない補完ポート (処理中の連打を試すため)。 */
function pendingRefine(): {
  port: PromptRefinementPort;
  calls: () => number;
} {
  let calls = 0;
  return {
    port: {
      refine: () => {
        calls += 1;
        return new Promise<RefineResult>(() => {});
      },
    },
    calls: () => calls,
  };
}

function instructionArea(): HTMLTextAreaElement {
  return screen.getByLabelText("作りたい動画の内容") as HTMLTextAreaElement;
}

describe("Step 41-1: 指示入力の Enter 送信 / Shift+Enter 改行", () => {
  it("有効なテキストで Enter を押すと送信が1回だけ実行される", async () => {
    const { port, calls } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");

    await screen.findByLabelText("最終プロンプト案（編集できます）");
    expect(calls()).toBe(1);
  });

  it("Shift+Enter は送信せず、textarea に改行を残す", async () => {
    const { port, calls } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(calls()).toBe(0);
    expect(instructionArea().value).toBe(`${SUFFICIENT}\n`);
  });

  it("空白のみの入力は Enter でもボタンでも送信されない", async () => {
    const { port, calls } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), "   ");
    await user.keyboard("{Enter}");
    expect(calls()).toBe(0);

    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    expect(calls()).toBe(0);
  });

  it("処理中の Enter 連打・ボタン連打で二重送信されない", async () => {
    const { port, calls } = pendingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("内容を確認中"),
    );

    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));

    expect(calls()).toBe(1);
  });
});

describe("Step 41-1: IME 変換確定中の誤送信防止", () => {
  it("isComposing: true の Enter は送信しない", async () => {
    const { port, calls } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    fireImeKeyDown(instructionArea(), { isComposing: true, keyCode: 13 });

    expect(calls()).toBe(0);
  });

  it("keyCode: 229 の Enter は送信しない", async () => {
    const { port, calls } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    fireImeKeyDown(instructionArea(), { isComposing: false, keyCode: 229 });

    expect(calls()).toBe(0);
  });

  it("compositionstart から compositionend までの Enter は送信しない", async () => {
    const { port, calls } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);

    // 変換中: isComposing も keyCode も通常値でも、composition 境界で送信しない。
    fireEvent.compositionStart(instructionArea());
    fireImeKeyDown(instructionArea(), { isComposing: false, keyCode: 13 });
    expect(calls()).toBe(0);

    // 変換確定後の通常 Enter は送信する。
    fireEvent.compositionEnd(instructionArea());
    fireImeKeyDown(instructionArea(), { isComposing: false, keyCode: 13 });

    await screen.findByLabelText("最終プロンプト案（編集できます）");
    expect(calls()).toBe(1);
  });
});

describe("Step 41-1: submit 経路の一本化", () => {
  it("指示入力の Enter と「内容をまとめる」ボタンは同じ form を通る", async () => {
    const { port } = countingRefine();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    const button = screen.getByRole("button", { name: "内容をまとめる" });
    const form = instructionArea().closest("form");

    expect(form).not.toBeNull();
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).toBe(form);

    // Enter はボタンを経由せず form の送信を要求する。
    const requestSubmit = vi.spyOn(form as HTMLFormElement, "requestSubmit");
    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("最終案の Enter と「この内容で送信」ボタンは同じ form の onSubmit を通る", async () => {
    const { port } = countingRefine();
    const onSubmit = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={onSubmit}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");

    const draft = await screen.findByLabelText("最終プロンプト案（編集できます）");
    const sendButton = screen.getByRole("button", { name: "この内容で送信" });
    const form = draft.closest("form");

    expect(form).not.toBeNull();
    expect(sendButton).toHaveAttribute("type", "submit");
    expect(sendButton.closest("form")).toBe(form);

    draft.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("最終案の Shift+Enter は送信せず改行する", async () => {
    const { port } = countingRefine();
    const onSubmit = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={onSubmit}
        refine={port}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");

    const draft = (await screen.findByLabelText(
      "最終プロンプト案（編集できます）",
    )) as HTMLTextAreaElement;
    // focus() ではキャレットが先頭に残るため、末尾を明示してから改行する。
    draft.focus();
    draft.setSelectionRange(draft.value.length, draft.value.length);
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(draft.value).toBe(`${SUFFICIENT}\n`);
  });

  it("Enter 送信の案内文言を表示し、指示入力から参照させる", async () => {
    const { port } = countingRefine();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={port}
      />,
    );

    const hintId = instructionArea().getAttribute("aria-describedby");
    expect(hintId).not.toBeNull();
    expect(document.getElementById(hintId as string)).toHaveTextContent(
      "Enter で送信 / Shift+Enter で改行",
    );
  });
});
