import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodingPanel } from "./CodingPanel";
import type { AikaApi } from "@shared/ipc/contract";
import type { CodingState } from "@main/coding/codingWorkflow";

/**
 * コーディング画面の契約テスト (plan 縦切り)。
 * goal 入力 -> 計画作成 (planCode) -> 計画表示。
 */
function installAikaMock(over: {
  planCode?: AikaApi["planCode"];
  executeCode?: AikaApi["executeCode"];
  verifyCode?: AikaApi["verifyCode"];
}) {
  const planCode = vi.fn(over.planCode ?? (async () => plannedState));
  const executeCode = vi.fn(
    over.executeCode ?? (async () => executedState),
  );
  const verifyCode = vi.fn(over.verifyCode ?? (async () => verifiedState));
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    checkUpdate: vi.fn(),
    planCode,
    executeCode,
    verifyCode,
  } as unknown as AikaApi;
  return { planCode, executeCode, verifyCode };
}

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const plannedState: CodingState = {
  phase: "planned",
  goal: "add feature",
  plan: {
    summary: "Plan for: add feature",
    steps: [
      { title: "分解", detail: "目標を分解する" },
      { title: "実装", detail: "最小差分を書く" },
    ],
  },
};

const executedState: CodingState = {
  ...plannedState,
  phase: "executed",
  executionLog: ["executed: 分解", "executed: 実装"],
};

const verifiedState: CodingState = {
  ...executedState,
  phase: "verified",
  verification: { passed: true, notes: ["verified (stub)"] },
};

beforeEach(() => {
  delete (window as { aika?: unknown }).aika;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CodingPanel (plan)", () => {
  it("goal 入力 -> 計画作成で planCode を呼び、計画を表示する", async () => {
    const { planCode } = installAikaMock({ planCode: async () => plannedState });
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "add feature");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));

    expect(planCode).toHaveBeenCalledWith("add feature");
    expect(
      await screen.findByText("Plan for: add feature"),
    ).toBeInTheDocument();
    expect(screen.getByText("分解")).toBeInTheDocument();
    expect(screen.getByText("実装")).toBeInTheDocument();
  });

  it("作成中はボタンを無効化する", async () => {
    const d = makeDeferred<CodingState>();
    installAikaMock({ planCode: () => d.promise });
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "x");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /作成/ }),
      ).toBeDisabled(),
    );

    d.resolve(plannedState);
    expect(
      await screen.findByText("Plan for: add feature"),
    ).toBeInTheDocument();
  });

  it("失敗時は alert を表示する", async () => {
    installAikaMock({
      planCode: async () => {
        throw new Error("goal が空です。");
      },
    });
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "x");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/goal/);
  });
});

describe("CodingPanel (execute)", () => {
  it("未計画時は実行ボタンが無効", () => {
    installAikaMock({});
    render(<CodingPanel />);
    expect(screen.getByRole("button", { name: "実行" })).toBeDisabled();
  });

  it("plan -> execute で executionLog を表示する", async () => {
    const { executeCode } = installAikaMock({
      planCode: async () => plannedState,
      executeCode: async () => executedState,
    });
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "add feature");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));
    await screen.findByText("Plan for: add feature");

    const runButton = screen.getByRole("button", { name: "実行" });
    expect(runButton).toBeEnabled();
    await user.click(runButton);

    expect(executeCode).toHaveBeenCalled();
    expect(await screen.findByText("executed: 分解")).toBeInTheDocument();
    expect(screen.getByText("executed: 実装")).toBeInTheDocument();
  });

  it("execute 失敗時は alert を表示する", async () => {
    installAikaMock({
      planCode: async () => plannedState,
      executeCode: async () => {
        throw new Error("execute は planned 状態でのみ可能です");
      },
    });
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "add feature");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));
    await screen.findByText("Plan for: add feature");
    await user.click(screen.getByRole("button", { name: "実行" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/planned/);
  });
});

describe("CodingPanel (verify)", () => {
  it("未実行時は検証ボタンが無効", () => {
    installAikaMock({});
    render(<CodingPanel />);
    expect(screen.getByRole("button", { name: "検証" })).toBeDisabled();
  });

  it("plan -> execute -> verify で検証結果を表示する", async () => {
    const { verifyCode } = installAikaMock({});
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "add feature");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));
    await screen.findByText("Plan for: add feature");
    await user.click(screen.getByRole("button", { name: "実行" }));
    await screen.findByText("executed: 分解");

    const verifyButton = screen.getByRole("button", { name: "検証" });
    expect(verifyButton).toBeEnabled();
    await user.click(verifyButton);

    expect(verifyCode).toHaveBeenCalled();
    expect(await screen.findByText(/passed/i)).toBeInTheDocument();
    expect(screen.getByText("verified (stub)")).toBeInTheDocument();
  });

  it("verify 失敗時は alert を表示する", async () => {
    installAikaMock({
      verifyCode: async () => {
        throw new Error("verify は executed 状態でのみ可能です");
      },
    });
    const user = userEvent.setup();
    render(<CodingPanel />);

    await user.type(screen.getByLabelText("目標 (goal)"), "add feature");
    await user.click(screen.getByRole("button", { name: "計画を作成" }));
    await screen.findByText("Plan for: add feature");
    await user.click(screen.getByRole("button", { name: "実行" }));
    await screen.findByText("executed: 分解");
    await user.click(screen.getByRole("button", { name: "検証" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/executed/);
  });
});
