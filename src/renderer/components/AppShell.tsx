import { useRef, useState, type KeyboardEvent } from "react";
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // tablist のキーボード操作 (Left/Right 循環, Home/End)。
  // フォーカスは選択タブへ移し、選択も同時に行う (自動活性化)。
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = TABS.findIndex((t) => t.key === active);
    let next = current;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % TABS.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab === undefined) return;
    setActive(nextTab.key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="app-shell">
      <div
        className="app-nav"
        role="tablist"
        aria-label="メインナビ"
        onKeyDown={onKeyDown}
      >
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${t.key}`}
            aria-controls={`panel-${t.key}`}
            aria-selected={active === t.key}
            tabIndex={active === t.key ? 0 : -1}
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
