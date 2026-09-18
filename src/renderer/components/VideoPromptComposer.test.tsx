import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import { acceptingSubmit } from "./testSubmit";

/**
 * 動画プロンプト対話型コンポーザの契約テスト。
 *
 * 自由指示 -> (曖昧なら補足質問/候補チップ) -> 最終プロンプト案の確認・編集 ->
 * 送信、の流れと状態機械 (idle/validating/follow-up/ready/sending/success/error)、
 * retry / やり直し、source 必須検証、a11y (status 短文 / 失敗のみ alert) を固定。
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

beforeEach(() => {
  /* no global api needed; composer takes onSubmit prop */
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VideoPromptComposer (十分な指示 -> ready -> 送信)", () => {
  it("十分な指示は follow-up を挟まず ready で最終案を出す", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />,
    );

    await user.type(
      screen.getByLabelText("作りたい動画の内容"),
      SUFFICIENT,
    );
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));

    const draft = await screen.findByLabelText("最終プロンプト案（編集できます）");
    expect(draft).toHaveValue(SUFFICIENT);
    expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("プロンプト案ができました");
  });

  it("最終案を編集して送信すると onSubmit に編集後プロンプトを渡す", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(
      <VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />,
    );

    await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));

    const draft = await screen.findByLabelText("最終プロンプト案（編集できます）");
    await user.type(draft, " 10秒");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "t2v",
        prompt: `${SUFFICIENT} 10秒`,
        params: {
      durationSec: 5,
      fps: 16,
      resolution: "720p",
      qualityPreset: "standard",
      motionStrength: 0.5,
    },
        assets: [],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("送信しました"),
    );
  });
});

describe("VideoPromptComposer (曖昧 -> follow-up)", () => {
  it("曖昧な指示では補足質問と候補チップを出す", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), "犬");
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));

    expect(
      await screen.findByText("主題は何ですか？（被写体・場面）"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "シネマティック" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("補足を入力してください");
  });

  it("補足質問に答えて続けると ready へ進む", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), "犬");
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByText("主題は何ですか？（被写体・場面）");

    await user.type(
      screen.getByLabelText("主題は何ですか？（被写体・場面）"),
      "浜辺を走るゴールデンレトリバー",
    );
    await user.click(screen.getByRole("button", { name: "続ける" }));

    const draft = await screen.findByLabelText("最終プロンプト案（編集できます）");
    expect((draft as HTMLTextAreaElement).value).toContain(
      "浜辺を走るゴールデンレトリバー",
    );
  });

  it("候補チップを押すと指示に追記される", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), "犬");
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByRole("button", { name: "シネマティック" });

    await user.click(screen.getByRole("button", { name: "シネマティック" }));
    expect(
      (screen.getByLabelText("作りたい動画の内容") as HTMLTextAreaElement).value,
    ).toContain("シネマティック");
  });
});

describe("VideoPromptComposer (source 必須検証)", () => {
  it("source 必須で未入力なら送信を阻止し alert を出す", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="i2v" sourceRequired onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByLabelText("最終プロンプト案（編集できます）");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/元画像/);
    const src = screen.getByLabelText("元画像のパス");
    expect(src).toHaveAttribute("aria-invalid", "true");
    expect(alert).toHaveAttribute("id", src.getAttribute("aria-describedby") as string);
    expect(screen.getByRole("status", { name: "送信状態" })).not.toHaveTextContent("元画像");
  });

  it("source を入力すれば onSubmit に含めて送信する", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="i2v" sourceRequired onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByLabelText("最終プロンプト案（編集できます）");
    await user.type(screen.getByLabelText("元画像のパス"), "/abs/in.png");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "i2v",
        prompt: SUFFICIENT,
        params: {
      durationSec: 5,
      fps: 16,
      resolution: "720p",
      qualityPreset: "standard",
      motionStrength: 0.5,
    },
        assets: [{ kind: "image", path: "/abs/in.png" }],
      }),
    );
  });
});

describe("VideoPromptComposer (error / retry)", () => {
  it("送信失敗で error 状態になり、alert 表示・retry で再送信できる", async () => {
    // 1回目はジョブ完了で失敗し、2回目は成功する。
    // completion は reject しない契約 (PR-G)。失敗も解決値で返すため、
    // 事前生成した拒否 Promise による unhandled rejection が起きない。
    const onSubmit = acceptingSubmit();
    onSubmit
      .mockImplementationOnce(async () => ({
        status: "accepted",
        jobId: "job-1",
        completion: Promise.resolve({
          status: "failed",
          messageKey: "media.job.failed",
        }),
      }))
      .mockImplementationOnce(async () => ({
        status: "accepted",
        jobId: "job-2",
        completion: Promise.resolve({ status: "succeeded" }),
      }));
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByLabelText("最終プロンプト案（編集できます）");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ジョブが失敗しました",
    );
    // status にエラー本文は混ぜない
    expect(
      screen.getByRole("status", { name: "送信状態" }),
    ).not.toHaveTextContent("ジョブが失敗しました");

    await user.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("送信しました"),
    );
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("VideoPromptComposer (a11y / 状態機械)", () => {
  it("status は role=status / polite / atomic で初期は idle 文言", () => {
    render(
      <VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={acceptingSubmit()} />,
    );
    const status = screen.getByRole("status", { name: "送信状態" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("内容を入力してください");
  });

  it("成功後にやり直すと idle へ戻る", async () => {
    const onSubmit = acceptingSubmit();
    const user = userEvent.setup();
    render(<VideoPromptComposer kind="t2v" sourceRequired={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("作りたい動画の内容"), SUFFICIENT);
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByLabelText("最終プロンプト案（編集できます）");
    await user.click(screen.getByRole("button", { name: "この内容で送信" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("送信しました"),
    );

    await user.click(screen.getByRole("button", { name: "新しく作成" }));
    expect(screen.getByLabelText("作りたい動画の内容")).toHaveValue("");
    expect(screen.getByRole("status", { name: "送信状態" })).toHaveTextContent("内容を入力してください");
  });
});
