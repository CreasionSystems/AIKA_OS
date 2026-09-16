import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import { acceptingSubmit } from "./testSubmit";
import {
  composerReducer,
  derivePhase,
  initialComposerState,
  type ComposerState,
} from "./composerReducer";
import type { ValidationIssue } from "@shared/media/videoValidation";
import type { RefineResult } from "@shared/media/promptRefinement";
import type { ComposerSubmitOutcome } from "./VideoPromptComposer";

/**
 * PR-E: 送信時の検証と状態遷移 (ADR-001 D5 / D6 / D9)。
 *
 * - validating: 送信要求から受理判定まで。失敗しても error にせず ready へ戻す
 * - sending: main 側で受理された後
 * - success: jobId を保持する
 * - 検証由来の指摘は refinement の候補とは別 state
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const READY: RefineResult = {
  status: "ready",
  draftPrompt: SUFFICIENT,
  summary: SUFFICIENT,
};

function readyState(): ComposerState {
  return [
    { type: "instruction-changed", text: SUFFICIENT } as const,
    { type: "instruction-submitted", requestId: "r1", at: 1 } as const,
    { type: "refinement-succeeded", requestId: "r1", at: 2, result: READY } as const,
  ].reduce(composerReducer, initialComposerState);
}

const ISSUE: ValidationIssue = {
  code: "invalid-parameter",
  field: "fps",
  value: 0,
  messageKey: "media.validation.invalidFps",
};

describe("状態遷移 (reducer)", () => {
  it("送信要求で validating へ入り、検証指摘は空になる", () => {
    const s = composerReducer(readyState(), {
      type: "send-requested",
      requestId: "s1",
    });
    expect(s.operation).toEqual({ status: "validating", requestId: "s1" });
    expect(derivePhase(s)).toBe("checking");
    expect(s.validationIssues).toEqual([]);
  });

  it("検証失敗は error にせず ready へ戻し、入力を保持する", () => {
    const ready = readyState();
    const failed = [
      { type: "send-requested", requestId: "s1" } as const,
      { type: "validation-failed", requestId: "s1", issues: [ISSUE] } as const,
    ].reduce(composerReducer, ready);

    expect(derivePhase(failed)).toBe("ready");
    expect(failed.operation).toEqual({ status: "idle" });
    expect(failed.validationIssues).toEqual([ISSUE]);
    // 入力は失われない。
    expect(failed.draft).toEqual(ready.draft);
    expect(failed.instruction).toBe(ready.instruction);
  });

  it("受理で sending へ入り、jobId を持つ", () => {
    const sending = [
      { type: "send-requested", requestId: "s1" } as const,
      { type: "send-accepted", requestId: "s1", jobId: "job-9" } as const,
    ].reduce(composerReducer, readyState());
    expect(sending.operation).toEqual({
      status: "sending",
      requestId: "s1",
      jobId: "job-9",
    });
    expect(derivePhase(sending)).toBe("sending");
  });

  it("成功は jobId を引き継ぐ", () => {
    const success = [
      { type: "send-requested", requestId: "s1" } as const,
      { type: "send-accepted", requestId: "s1", jobId: "job-9" } as const,
      { type: "send-succeeded", requestId: "s1" } as const,
    ].reduce(composerReducer, readyState());
    expect(success.operation).toEqual({
      status: "success",
      requestId: "s1",
      jobId: "job-9",
    });
  });

  it("該当入力を直すと、その field の指摘だけが消える", () => {
    const other: ValidationIssue = {
      code: "invalid-parameter",
      field: "durationSec",
      value: 0,
      messageKey: "media.validation.invalidDuration",
    };
    const failed = [
      { type: "send-requested", requestId: "s1" } as const,
      {
        type: "validation-failed",
        requestId: "s1",
        issues: [ISSUE, other],
      } as const,
    ].reduce(composerReducer, readyState());

    const fixed = composerReducer(failed, {
      type: "param-changed",
      key: "fps",
      value: 24,
    });
    expect(fixed.validationIssues).toEqual([other]);
  });

  it("redo / reset で検証指摘を解除する", () => {
    const failed = [
      { type: "send-requested", requestId: "s1" } as const,
      { type: "validation-failed", requestId: "s1", issues: [ISSUE] } as const,
    ].reduce(composerReducer, readyState());
    expect(
      composerReducer(failed, { type: "redo-requested" }).validationIssues,
    ).toEqual([]);
    expect(
      composerReducer(failed, { type: "reset-requested" }).validationIssues,
    ).toEqual([]);
  });

  it("検証指摘と refinement の候補は別 state", () => {
    const failed = [
      { type: "send-requested", requestId: "s1" } as const,
      { type: "validation-failed", requestId: "s1", issues: [ISSUE] } as const,
    ].reduce(composerReducer, readyState());
    expect(failed.suggestions).toEqual([]);
    expect(failed.validationIssues).toHaveLength(1);
  });

  it("古い世代の受理・検証失敗は状態を上書きしない", () => {
    const current = [
      { type: "send-requested", requestId: "s1" } as const,
      { type: "send-requested", requestId: "s2" } as const,
    ].reduce(composerReducer, readyState());

    expect(
      composerReducer(current, {
        type: "send-accepted",
        requestId: "s1",
        jobId: "old",
      }),
    ).toBe(current);
    expect(
      composerReducer(current, {
        type: "validation-failed",
        requestId: "s1",
        issues: [ISSUE],
      }),
    ).toBe(current);
  });
});

describe("送信経路 (component)", () => {
  async function renderReady(
    onSubmit: (req: never) => Promise<ComposerSubmitOutcome>,
  ) {
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={onSubmit as never}
      />,
    );
    await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByLabelText("最終プロンプト案（編集できます）");
    return user;
  }

  it("renderer の事前検証で落ちると送信せず、field に紐づけて表示する", async () => {
    const onSubmit = acceptingSubmit();
    const user = await renderReady(onSubmit);

    const fps = screen.getByLabelText("fps");
    await user.clear(fps);
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    // IPC へは行かない。
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fps).toHaveAttribute("aria-invalid", "true");
    // 入力は保持される。
    expect(screen.getByLabelText("最終プロンプト案（編集できます）")).toHaveValue(
      SUFFICIENT,
    );
    // error 状態にはしない。
    expect(
      screen.getByRole("status", { name: "送信状態" }),
    ).not.toHaveTextContent("エラー");
  });

  it("main が invalid を返しても error にせず、指摘を表示する", async () => {
    const onSubmit = vi.fn(
      async (): Promise<ComposerSubmitOutcome> => ({
        status: "invalid",
        issues: [ISSUE],
      }),
    );
    const user = await renderReady(onSubmit);
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("fps")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "送信状態" }),
      ).toHaveTextContent("プロンプト案ができました"),
    );
  });

  it("受理後にジョブが完了すると success になる", async () => {
    const onSubmit = acceptingSubmit("job-42");
    const user = await renderReady(onSubmit);
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "送信状態" }),
      ).toHaveTextContent("送信しました"),
    );
    // 正規化済み要求が渡る。
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "t2v", prompt: SUFFICIENT, assets: [] }),
    );
  });
});
