import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaPanel } from "./MediaPanel";
import type { AikaApi } from "@shared/ipc/contract";
import type { Job } from "@main/jobs/jobQueue";
import { DEFAULT_SETTINGS } from "@shared/settings/settings";

/**
 * メディアタブ (画像ジョブ) の契約テスト。
 * 投入 (submitImageJob) -> 自動ポーリング (getJob) -> 状態 / 生成物表示。
 * sleep を注入して決定的に検証する。
 */
function installAikaMock(over: {
  submitImageJob?: AikaApi["submitImageJob"];
  submitVideoJob?: AikaApi["submitVideoJob"];
  getJob?: AikaApi["getJob"];
  getSettings?: AikaApi["getSettings"];
  listJobs?: AikaApi["listJobs"];
}) {
  const submitImageJob = vi.fn(over.submitImageJob ?? (async () => "job-1"));
  const submitVideoJob = vi.fn(over.submitVideoJob ?? (async () => "job-1"));
  const getJob = vi.fn(over.getJob ?? (async () => undefined));
  const getSettings = vi.fn(
    over.getSettings ?? (async () => DEFAULT_SETTINGS),
  );
  const listJobs = vi.fn(over.listJobs ?? (async () => []));
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob,
    submitVideoJob,
    getJob,
    getSettings,
    saveSettings: vi.fn(),
    checkUpdate: vi.fn(),
    planCode: vi.fn(),
    executeCode: vi.fn(),
    verifyCode: vi.fn(),
    rewindCode: vi.fn(),
    listJobs,
  } as unknown as AikaApi;
  return { submitImageJob, submitVideoJob, getJob, listJobs };
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
const videoSucceededJob: Job = {
  id: "job-1",
  state: "succeeded",
  createdAt: 1,
  startedAt: 2,
  finishedAt: 3,
  result: {
    jobId: "media-1",
    status: "succeeded",
    backend: "dummy",
    kind: "t2v",
    artifacts: ["/var/lib/aika/artifacts/media-1.t2v.mp4"],
  },
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

describe("MediaPanel (ジョブ履歴)", () => {
  it("完了後にジョブ履歴を表示し、status には履歴本文を混ぜない", async () => {
    installAikaMock({
      getJob: seqGetJob([queuedJob, succeededJob]),
      listJobs: async () => [
        {
          jobId: "job-1",
          state: "succeeded",
          artifacts: ["/var/lib/aika/artifacts/media-1.png"],
        },
      ],
    });
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.type(screen.getByLabelText("プロンプト"), "a cat");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );

    const histList = await screen.findByRole("list", { name: "ジョブ履歴" });
    expect(within(histList).getByText(/job-1/)).toBeInTheDocument();
    // 履歴本文 (jobId) を live region には出さない
    expect(screen.getByRole("status")).not.toHaveTextContent("job-1");
  });
});

describe("MediaPanel (ポーリング間隔の設定連携)", () => {
  it("pollInterval 未指定なら設定値 (mediaPollIntervalMs) を周期に使う", async () => {
    installAikaMock({
      getJob: seqGetJob([queuedJob, succeededJob]),
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        mediaPollIntervalMs: 250,
      }),
    });
    const slept: number[] = [];
    const recordingSleep = async (ms: number) => {
      slept.push(ms);
    };
    const user = userEvent.setup();
    render(<MediaPanel sleep={recordingSleep} />);

    await user.type(screen.getByLabelText("プロンプト"), "a cat");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );
    expect(slept).toContain(250);
  });

  it("pollInterval を明示指定した場合は設定値より優先する", async () => {
    installAikaMock({
      getJob: seqGetJob([queuedJob, succeededJob]),
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        mediaPollIntervalMs: 250,
      }),
    });
    const slept: number[] = [];
    const recordingSleep = async (ms: number) => {
      slept.push(ms);
    };
    const user = userEvent.setup();
    render(<MediaPanel sleep={recordingSleep} pollInterval={777} />);

    await user.type(screen.getByLabelText("プロンプト"), "a cat");
    await user.click(screen.getByRole("button", { name: "画像ジョブを投入" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );
    expect(slept).toContain(777);
    expect(slept).not.toContain(250);
  });
});

describe("MediaPanel (種別選択 / 動画)", () => {
  it("種別セレクタを持ち、既定は画像", () => {
    installAikaMock({});
    render(<MediaPanel sleep={instantSleep} />);
    expect(screen.getByLabelText("種別")).toHaveValue("image");
    expect(
      screen.getByRole("button", { name: "画像ジョブを投入" }),
    ).toBeInTheDocument();
  });

  it("動画(t2v)を選んで投入すると submitVideoJob を呼ぶ", async () => {
    const { submitVideoJob, submitImageJob } = installAikaMock({
      getJob: seqGetJob([queuedJob, videoSucceededJob]),
    });
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.selectOptions(screen.getByLabelText("種別"), "t2v");
    await user.type(screen.getByLabelText("プロンプト"), "a dog runs");
    await user.click(screen.getByRole("button", { name: "動画ジョブを投入" }));

    expect(submitVideoJob).toHaveBeenCalledWith({
      kind: "t2v",
      prompt: "a dog runs",
    });
    expect(submitImageJob).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );
    expect(
      screen.getByText("/var/lib/aika/artifacts/media-1.t2v.mp4"),
    ).toBeInTheDocument();
    expect(screen.getByText("種別: t2v")).toBeInTheDocument();
  });
});

describe("MediaPanel (sourceImage 入力)", () => {
  it("source 必須の種別 (i2v) でのみ sourceImage 欄を表示する", async () => {
    installAikaMock({});
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    // 画像・t2v では非表示
    expect(screen.queryByLabelText("元画像のパス")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("種別"), "t2v");
    expect(screen.queryByLabelText("元画像のパス")).not.toBeInTheDocument();

    // i2v では可視ラベル付きで表示
    await user.selectOptions(screen.getByLabelText("種別"), "i2v");
    expect(screen.getByLabelText("元画像のパス")).toBeInTheDocument();
  });

  it("i2v で sourceImage 未入力なら投入を阻止し、入力に検証を関連付ける", async () => {
    const { submitVideoJob } = installAikaMock({});
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.selectOptions(screen.getByLabelText("種別"), "i2v");
    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "動画ジョブを投入" }));

    expect(submitVideoJob).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/元画像/);

    const input = screen.getByLabelText("元画像のパス");
    expect(input).toHaveAttribute("aria-invalid", "true");
    // エラーは aria-describedby で入力に関連付ける
    const describedby = input.getAttribute("aria-describedby");
    expect(describedby).toBeTruthy();
    expect(alert).toHaveAttribute("id", describedby as string);
    // 状態 live region にはエラーを混ぜない
    expect(screen.getByRole("status")).not.toHaveTextContent("元画像");
  });

  it("i2v で sourceImage を入力すると submitVideoJob に含めて投入する", async () => {
    const { submitVideoJob } = installAikaMock({
      getJob: seqGetJob([queuedJob, videoSucceededJob]),
    });
    const user = userEvent.setup();
    render(<MediaPanel sleep={instantSleep} />);

    await user.selectOptions(screen.getByLabelText("種別"), "i2v");
    await user.type(screen.getByLabelText("プロンプト"), "make it move");
    await user.type(screen.getByLabelText("元画像のパス"), "/abs/in.png");
    await user.click(screen.getByRole("button", { name: "動画ジョブを投入" }));

    expect(submitVideoJob).toHaveBeenCalledWith({
      kind: "i2v",
      prompt: "make it move",
      sourceImage: "/abs/in.png",
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("完了しました"),
    );
  });
});
