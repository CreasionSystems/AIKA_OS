import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdatePanel } from "./UpdatePanel";
import type { AikaApi } from "@shared/ipc/contract";
import type { UpdateState } from "@main/update/updateManager";

/**
 * 更新画面の契約テスト。確認ボタン -> 状態表示。
 * checking は UI の保留状態、最終遷移は checkUpdate の戻り値で表示する。
 */
function installAikaMock(checkUpdate: AikaApi["checkUpdate"]) {
  const fn = vi.fn(checkUpdate);
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    checkUpdate: fn,
  } as unknown as AikaApi;
  return fn;
}

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

beforeEach(() => {
  delete (window as { aika?: unknown }).aika;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UpdatePanel", () => {
  it("初期は未確認で、確認ボタンを持つ", () => {
    installAikaMock(async () => ({ phase: "up-to-date" }));
    render(<UpdatePanel />);
    expect(screen.getByRole("button", { name: "更新を確認" })).toBeEnabled();
    expect(screen.getByText("未確認")).toBeInTheDocument();
  });

  it("確認 -> 最新なら up-to-date を表示", async () => {
    installAikaMock(async () => ({ phase: "up-to-date" }));
    const user = userEvent.setup();
    render(<UpdatePanel />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("最新です")).toBeInTheDocument();
  });

  it("確認 -> 更新ありならバージョンを表示", async () => {
    installAikaMock(async () => ({
      phase: "available",
      info: { version: "1.2.0" },
    }));
    const user = userEvent.setup();
    render(<UpdatePanel />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText(/1\.2\.0/)).toBeInTheDocument();
  });

  it("確認 -> エラーなら alert を表示", async () => {
    installAikaMock(async () => ({ phase: "error", error: "network down" }));
    const user = userEvent.setup();
    render(<UpdatePanel />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/network down/);
  });

  it("確認中はボタンを無効化し、確認中を表示する", async () => {
    const d = makeDeferred<UpdateState>();
    installAikaMock(() => d.promise);
    const user = userEvent.setup();
    render(<UpdatePanel />);

    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "更新を確認" })).toBeDisabled(),
    );
    expect(screen.getByText("確認中…")).toBeInTheDocument();

    d.resolve({ phase: "up-to-date" });
    expect(await screen.findByText("最新です")).toBeInTheDocument();
  });
});
