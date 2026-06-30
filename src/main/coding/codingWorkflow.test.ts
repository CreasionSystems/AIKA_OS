import { describe, it, expect, vi } from "vitest";
import { CodingWorkflow, type CodePlanner } from "./codingWorkflow";
import type { CodePlanResult } from "@shared/inference/port";

/**
 * コーディング支援の骨格テスト (Plan / Execute / Verify / Rewind)。
 *
 * 固定する契約:
 *  - phase: idle -> planned -> executed -> verified
 *  - 不正遷移はガードで throw
 *  - rewind は1手戻し (履歴 pop)
 *  - plan は注入された generateCodePlan を結線して計画を取得する
 */

const fixedPlan: CodePlanResult = {
  summary: "Plan for: add feature",
  steps: [
    { title: "Plan", detail: "分解する" },
    { title: "Execute", detail: "実装する" },
  ],
};

function makePlanner(plan: CodePlanResult = fixedPlan): {
  planner: CodePlanner;
  generateCodePlan: ReturnType<typeof vi.fn>;
} {
  const generateCodePlan = vi.fn(async () => plan);
  return { planner: { generateCodePlan }, generateCodePlan };
}

describe("初期状態", () => {
  it("phase は idle で rewind 不可", () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    expect(wf.getState().phase).toBe("idle");
    expect(wf.canRewind()).toBe(false);
  });
});

describe("plan", () => {
  it("generateCodePlan を goal で呼び、planned へ遷移し計画を保持する", async () => {
    const { planner, generateCodePlan } = makePlanner();
    const wf = new CodingWorkflow(planner);

    await wf.plan("add feature");

    expect(generateCodePlan).toHaveBeenCalledWith({ goal: "add feature" });
    const s = wf.getState();
    expect(s.phase).toBe("planned");
    expect(s.goal).toBe("add feature");
    expect(s.plan).toEqual(fixedPlan);
    expect(wf.canRewind()).toBe(true);
  });
});

describe("execute / verify の遷移とガード", () => {
  it("planned -> executed -> verified へ進む", async () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    await wf.plan("g");

    wf.execute();
    expect(wf.getState().phase).toBe("executed");
    expect(wf.getState().executionLog?.length).toBeGreaterThan(0);

    wf.verify();
    expect(wf.getState().phase).toBe("verified");
    expect(wf.getState().verification?.passed).toBe(true);
  });

  it("idle から execute はガードで throw", () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    expect(() => wf.execute()).toThrow(/planned/);
  });

  it("execute 前の verify はガードで throw", async () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    await wf.plan("g");
    expect(() => wf.verify()).toThrow(/executed/);
  });
});

describe("rewind", () => {
  it("plan の後に rewind すると idle に戻る", async () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    await wf.plan("g");
    wf.rewind();
    expect(wf.getState().phase).toBe("idle");
    expect(wf.canRewind()).toBe(false);
  });

  it("plan -> execute -> verify を3回 rewind で idle まで戻す", async () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    await wf.plan("g");
    wf.execute();
    wf.verify();

    expect(wf.getState().phase).toBe("verified");
    wf.rewind();
    expect(wf.getState().phase).toBe("executed");
    wf.rewind();
    expect(wf.getState().phase).toBe("planned");
    wf.rewind();
    expect(wf.getState().phase).toBe("idle");
  });

  it("履歴が無い状態の rewind は throw", () => {
    const { planner } = makePlanner();
    const wf = new CodingWorkflow(planner);
    expect(() => wf.rewind()).toThrow();
  });
});
