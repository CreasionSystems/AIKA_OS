import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WritingPanel } from "./WritingPanel";
import { UpdatePanel } from "./UpdatePanel";
import { CodingPanel } from "./CodingPanel";
import i18n from "../i18n";
import type { AikaApi } from "@shared/ipc/contract";
import type { CodingView } from "@main/coding/codingWorkflow";
import type { UiLocale } from "@shared/i18n/language";

/**
 * Writing / Update / Coding パネルの多言語切替の契約テスト。
 *
 * 6 ロケールすべてで見出し / 主要ボタン / status(idle) が実訳表示されること
 * (en フォールバックに頼らない) を固定する。詳細な操作フローは各パネルの
 * 既存テスト (ja) が担保する。
 */
function installAikaMock() {
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    checkUpdate: vi.fn(),
    planCode: vi.fn(),
    executeCode: vi.fn(),
    verifyCode: vi.fn(),
    rewindCode: vi.fn(),
    listJobs: vi.fn(async () => []),
    clearJobs: vi.fn(async () => {}),
  } as unknown as AikaApi;
}

beforeEach(() => installAikaMock());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Expected {
  writingTitle: string;
  writingGenerate: string;
  writingIdle: string;
  updateTitle: string;
  updateCheck: string;
  updateIdle: string;
  codingTitle: string;
  codingPlan: string;
  codingIdle: string;
}

const EXPECTED: Record<UiLocale, Expected> = {
  ja: {
    writingTitle: "文章作成",
    writingGenerate: "生成",
    writingIdle: "未生成",
    updateTitle: "更新",
    updateCheck: "更新を確認",
    updateIdle: "未確認",
    codingTitle: "コーディング",
    codingPlan: "計画を作成",
    codingIdle: "未着手",
  },
  en: {
    writingTitle: "Writing",
    writingGenerate: "Generate",
    writingIdle: "Not generated",
    updateTitle: "Updates",
    updateCheck: "Check for updates",
    updateIdle: "Not checked",
    codingTitle: "Coding",
    codingPlan: "Create plan",
    codingIdle: "Not started",
  },
  ko: {
    writingTitle: "글쓰기",
    writingGenerate: "생성",
    writingIdle: "생성 안 됨",
    updateTitle: "업데이트",
    updateCheck: "업데이트 확인",
    updateIdle: "확인 안 됨",
    codingTitle: "코딩",
    codingPlan: "계획 생성",
    codingIdle: "시작 안 됨",
  },
  "zh-Hans": {
    writingTitle: "写作",
    writingGenerate: "生成",
    writingIdle: "未生成",
    updateTitle: "更新",
    updateCheck: "检查更新",
    updateIdle: "未检查",
    codingTitle: "编程",
    codingPlan: "生成计划",
    codingIdle: "未开始",
  },
  "zh-Hant": {
    writingTitle: "寫作",
    writingGenerate: "生成",
    writingIdle: "未生成",
    updateTitle: "更新",
    updateCheck: "檢查更新",
    updateIdle: "未檢查",
    codingTitle: "程式設計",
    codingPlan: "產生計畫",
    codingIdle: "未開始",
  },
  fr: {
    writingTitle: "Rédaction",
    writingGenerate: "Générer",
    writingIdle: "Non généré",
    updateTitle: "Mises à jour",
    updateCheck: "Rechercher des mises à jour",
    updateIdle: "Non vérifié",
    codingTitle: "Codage",
    codingPlan: "Créer un plan",
    codingIdle: "Non démarré",
  },
};

const LOCALES = Object.keys(EXPECTED) as UiLocale[];

describe("WritingPanel 多言語切替", () => {
  for (const locale of LOCALES) {
    it(`${locale}: 見出し / 生成ボタン / status(idle)`, async () => {
      await i18n.changeLanguage(locale);
      const e = EXPECTED[locale];
      render(<WritingPanel />);
      expect(
        screen.getByRole("heading", { name: e.writingTitle }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: e.writingGenerate }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(e.writingIdle);
    });
  }
});

describe("UpdatePanel 多言語切替", () => {
  for (const locale of LOCALES) {
    it(`${locale}: 見出し / 確認ボタン / status(idle)`, async () => {
      await i18n.changeLanguage(locale);
      const e = EXPECTED[locale];
      render(<UpdatePanel />);
      expect(
        screen.getByRole("heading", { name: e.updateTitle }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: e.updateCheck }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(e.updateIdle);
    });
  }
});

describe("CodingPanel 多言語切替", () => {
  for (const locale of LOCALES) {
    it(`${locale}: 見出し / 計画ボタン / status(idle)`, async () => {
      await i18n.changeLanguage(locale);
      const e = EXPECTED[locale];
      render(<CodingPanel />);
      expect(
        screen.getByRole("heading", { name: e.codingTitle }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: e.codingPlan }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(e.codingIdle);
    });
  }
});

/** 件数は plural 機構で扱う (文字列連結しない)。 */
function planWithSteps(n: number): CodingView {
  return {
    phase: "planned",
    goal: "g",
    plan: {
      summary: "Plan for: g",
      steps: Array.from({ length: n }, (_, i) => ({
        title: `t${i}`,
        detail: `d${i}`,
      })),
    },
    canRewind: true,
  };
}

describe("CodingPanel status の plural / interpolation", () => {
  it("en: 複数手順は plural(other)、単数は plural(one)", async () => {
    await i18n.changeLanguage("en");
    (window as unknown as { aika: AikaApi }).aika = {
      ...(window as unknown as { aika: AikaApi }).aika,
      planCode: vi.fn(async () => planWithSteps(2)),
    } as unknown as AikaApi;
    const user = userEvent.setup();
    const { unmount } = render(<CodingPanel />);
    await user.type(screen.getByLabelText("Goal"), "g");
    await user.click(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Created a plan (2 steps)",
      ),
    );
    unmount();

    (window as unknown as { aika: AikaApi }).aika = {
      ...(window as unknown as { aika: AikaApi }).aika,
      planCode: vi.fn(async () => planWithSteps(1)),
    } as unknown as AikaApi;
    render(<CodingPanel />);
    await user.type(screen.getByLabelText("Goal"), "g");
    await user.click(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Created a plan (1 step)",
      ),
    );
  });
});

describe("UpdatePanel status の interpolation", () => {
  it("fr: 新バージョンは version 変数で埋め込む", async () => {
    await i18n.changeLanguage("fr");
    (window as unknown as { aika: AikaApi }).aika = {
      ...(window as unknown as { aika: AikaApi }).aika,
      checkUpdate: vi.fn(async () => ({
        phase: "available" as const,
        info: { version: "2.3.4" },
      })),
    } as unknown as AikaApi;
    const user = userEvent.setup();
    render(<UpdatePanel />);
    await user.click(
      screen.getByRole("button", { name: "Rechercher des mises à jour" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Une nouvelle version (2.3.4) est disponible",
      ),
    );
  });
});
