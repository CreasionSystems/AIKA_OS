import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaPanel } from "./MediaPanel";
import type { AikaApi } from "@shared/ipc/contract";
import type { Job } from "@main/jobs/jobQueue";

/**
 * メディアタブ (画像ジョブ) の契約テスト。
 * 投入 (submitImageJob) -> 自動ポーリング (getJob) -> 状態 / 生成物表示。
 * sleep を注入して決定的に検証する。
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

/** 注入用: 待たない sleep。 */
const instantSleep = async () => {};

const queuedJob: Job = { id: "job-1", state: "queued", createdAt: 1 };
const runningJob: Job = { id: "job-1", state: "running", createdAt: 1, startedAt: 2 };
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
const failedJob: Job = {
  id: "job-1",
  state: "failed",
  createdAt: 1,
  startedAt: 2,
  finishedAt: 3,
  error: "backend exploded",
};

/** 呼び出しごとに配列の次要素 (末尾以降は最後の要素) を返す getJob。 */
function seqGetJob(jobs: Job[]): AikaApi["getJob"] {
  let i = 0;
  return async () => {
    const j = jobs[Math.min(i, jobs.length - 1)];
    i += 1;
    return j;
  };
}

beforeEach(() => {
  delete (window as { aika?: unknown }).aika;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MediaPanel (自動ポーリング)", () => {
  it("投入で submitImageJob を呼び、自動ポーリングで完了まで進む", async () => {
    const { submitImageJob, getJob } = installAikaMock({
      getJob: seqGetJob([queuedJob, runningJob, succeededJob]),
    });
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.type(screen.getByLabelText("プロンプト"), "a cat");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    expect(submitImageJob).toHaveBeenCalledWith({ prompt: "a cat" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );
    expect(getJob).toHaveBeenCalledWith("job-1");
    expect(
      screen.getByText("/var/lib/aika/artifacts/media-1.png"),
    ).toBeInTheDocument();
  });

  it("failed で停止し『失敗しました』を表示する (生成物なし)", async () => {
    installAikaMock({ getJob: seqGetJob([queuedJob, failedJob]) });
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("失敗しました"),
    );
    expect(screen.queryByLabelText("生成物")).not.toBeInTheDocument();
  });

  it("完了後も『状態を更新』で再取得できる", async () => {
    const { getJob } = installAikaMock({
      getJob: seqGetJob([succeededJob]),
    });
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );

    const callsBefore = getJob.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "状態を更新" }));
    expect(getJob.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("未投入時は更新ボタンが無効", () => {
    installAikaMock({});
    render(<MediaPanel sleep={instantSleep} />);
    expect(screen.getByRole("button", { name: "状態を更新" })).toBeDisabled();
  });

  it("状態サマリーは role=status / polite / atomic で初期から『未投入』", () => {
    installAikaMock({});
    render(<MediaPanel sleep={instantSleep} />);
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
    render(<MediaPanel sleep={instantSleep} />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/backend down/);
    expect(screen.getByRole("status")).not.toHaveTextContent("backend down");
  });
});
