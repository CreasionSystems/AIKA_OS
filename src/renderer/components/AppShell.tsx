import { useState } from "react";
import { WritingPanel } from "./WritingPanel";
import { SettingsPanel } from "./SettingsPanel";
import { UpdatePanel } from "./UpdatePanel";
import { CodingPanel } from "./CodingPanel";

/**
 * 画面シェル。文章作成 / 設定 / 更新 / コーディング をタブで切り替える。
 * 目的は導線整理であり、見た目の作り込みは後続。
 */
type TabKey = "writing" | "settings" | "update" | "coding";

const TABS: { key: TabKey; label: string }[] = [
  { key: "writing", label: "文章作成" },
  { key: "settings", label: "設定" },
  { key: "update", label: "更新" },
  { key: "coding", label: "コーディング" },
];

function renderPanel(tab: TabKey) {
  switch (tab) {
    case "writing":
      return <WritingPanel />;
    case "settings":
      return <SettingsPanel />;
    case "update":
      return <UpdatePanel />;
    case "coding":
      return <CodingPanel />;
  }
}

export function AppShell() {
  const [active, setActive] = useState<TabKey>("writing");

  return (
    <div className="app-shell">
      <div className="app-nav" role="tablist" aria-label="メインナビ">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            id={`tab-${t.key}`}
            aria-controls={`panel-${t.key}`}
            aria-selected={active === t.key}
            className={active === t.key ? "app-tab is-active" : "app-tab"}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="app-panel"
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
      >
        {renderPanel(active)}
      </div>
    </div>
  );
}
