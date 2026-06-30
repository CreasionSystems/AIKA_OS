import { useEffect, useState, type FormEvent } from "react";
import { getAikaApi } from "@preload/windowApi";
import { WRITING_MODES } from "@shared/writing/writingModes";
import {
  SettingsValidationError,
  type AppSettings,
  type ThemeSetting,
} from "@shared/settings/settings";
import type { WritingMode } from "@shared/inference/port";

/** 設定画面。読込 -> 編集 -> 保存の往復を行う。 */
type Phase = "loading" | "ready" | "saving" | "saved" | "error";

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
  { value: "system", label: "システム" },
];

const MODE_OPTIONS = Object.values(WRITING_MODES);

function toErrorMessage(err: unknown): string {
  if (err instanceof SettingsValidationError) {
    return err.violations.map((v) => v.message).join(" / ");
  }
  return err instanceof Error ? err.message : String(err);
}

/** live region 用の短い状態サマリー。 */
function summarize(phase: Phase): string {
  switch (phase) {
    case "saving":
      return "保存中…";
    case "saved":
      return "保存しました";
    default:
      return "未保存";
  }
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAikaApi()
      .getSettings()
      .then((s) => {
        if (active) {
          setSettings(s);
          setPhase("ready");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (settings === null) {
    return <p>読み込み中…</p>;
  }

  function patch(update: Partial<AppSettings>) {
    setSettings((prev) => (prev === null ? prev : { ...prev, ...update }));
    setPhase("ready");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (settings === null) return;
    setPhase("saving");
    setError(null);
    try {
      const saved = await getAikaApi().saveSettings(settings);
      setSettings(saved);
      setPhase("saved");
    } catch (err) {
      setError(toErrorMessage(err));
      setPhase("error");
    }
  }

  return (
    <section>
      <h1>設定</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="settings-theme">テーマ</label>
        <select
          id="settings-theme"
          value={settings.theme}
          onChange={(e) => patch({ theme: e.target.value as ThemeSetting })}
        >
          {THEME_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <label htmlFor="settings-mode">既定の文章モード</label>
        <select
          id="settings-mode"
          value={settings.defaultWritingMode}
          onChange={(e) =>
            patch({ defaultWritingMode: e.target.value as WritingMode })
          }
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.mode} value={m.mode}>
              {m.label}
            </option>
          ))}
        </select>

        <label htmlFor="settings-job-limit">ジョブ履歴の上限</label>
        <input
          id="settings-job-limit"
          type="number"
          value={settings.jobHistoryLimit}
          onChange={(e) =>
            patch({ jobHistoryLimit: e.target.valueAsNumber })
          }
        />

        <button type="submit" disabled={phase === "saving"}>
          保存
        </button>
      </form>

      {/* 短い状態サマリーのみ live region に置く。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize(phase)}
      </p>

      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
