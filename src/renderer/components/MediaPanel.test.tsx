import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaPanel } from "./MediaPanel";
import type { AikaApi } from "@shared/ipc/contract";
import type { Job } from "@main/jobs/jobQueue";

/**
 * メディアタブ (画像ジョブ) の契約テスト。
 * 投入 (submitImageJob) -> 状態取得 (getJob) -> 状態 / 生成物表示。
 */
function installAikaMock(over: {
  submitImageJob?: AikaApi["submitImageJob"];
  getJob?: AikaApi["getJob"];
}) {
  const submitImageJob = vi.fn(over.submitImageJob ?? (async () => "job-1"));
  const getJob = vi.fn(over.getJob ?? (async () => undefined));
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob,
    submitVideoJob: vi.fn(),
    getJob,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    checkUpdate: vi.fn(),
    planCode: vi.fn(),
    executeCode: vi.fn(),
    verifyCode: vi.fn(),
    rewindCode: vi.fn(),
  } as unknown as AikaApi;
  return { submitImageJob, getJob };
}

const queuedJob: Job = { id: "job-1", state: "queued", createdAt: 1 };
const succeededJob: Job = {
  id: "job-1",
  state: "succeeded",
  createdAt: 1,
  startedAt: 2,
  finishedAt: 3,
  result: {
    jobId: "media-1",
    status: "succeeded",
    backend: "dummy",
    artifacts: ["/var/lib/aika/artifacts/media-1.png"],
  },
};

beforeEach(() => {
  delete (window as { aika?: unknown }).aika;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MediaPanel", () => {
  it("投入で submitImageJob を呼び、jobId と状態を表示する", async () => {
    const { submitImageJob, getJob } = installAikaMock({
      getJob: async () => queuedJob,
    });
    const user = userEvent.setup();
    render(<MediaPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "a cat");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    expect(submitImageJob).toHaveBeenCalledWith({ prompt: "a cat" });
    expect(getJob).toHaveBeenCalledWith("job-1");
    expect(await screen.findByText(/job-1/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("待機中");
  });

  it("更新で getJob を再取得し、完了と生成物を表示する", async () => {
    let calls = 0;
    installAikaMock({
      getJob: async () => {
        calls += 1;
        return calls === 1 ? queuedJob : succeededJob;
      },
    });
    const user = userEvent.setup();
    render(<MediaPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "a cat");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));
    await screen.findByText(/job-1/);

    await user.click(screen.getByRole("button", { name: "状態を更新" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );
    expect(
      screen.getByText("/var/lib/aika/artifacts/media-1.png"),
    ).toBeInTheDocument();
  });

  it("未投入時は更新ボタンが無効", () => {
    installAikaMock({});
    render(<MediaPanel />);
    expect(screen.getByRole("button", { name: "状態を更新" })).toBeDisabled();
  });

  it("状態サマリーは role=status / polite / atomic で初期から『未投入』", () => {
    installAikaMock({});
    render(<MediaPanel />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("未投入");
  });

  it("失敗時は alert を表示し、status には混ぜない", async () => {
    installAikaMock({
      submitImageJob: async () => {
        throw new Error("backend down");
      },
    });
    const user = userEvent.setup();
    render(<MediaPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/backend down/);
    expect(screen.getByRole("status")).not.toHaveTextContent("backend down");
  });
});
