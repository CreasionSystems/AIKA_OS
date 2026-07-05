import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { WritingPanel } from "./WritingPanel";
import { SettingsPanel } from "./SettingsPanel";
import { UpdatePanel } from "./UpdatePanel";
import { CodingPanel } from "./CodingPanel";
import { MediaPanel } from "./MediaPanel";

/**
 * 画面シェル。文章作成 / 設定 / 更新 / コーディング / メディア をタブで切り替える。
 * 目的は導線整理であり、見た目の作り込みは後続。
 * ラベルは i18n。文言長が伸びても崩れないよう固定幅前提は避ける。
 */
type TabKey = "writing" | "settings" | "update" | "coding" | "media";

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: "writing", labelKey: "nav.tab.writing" },
  { key: "settings", labelKey: "nav.tab.settings" },
  { key: "update", labelKey: "nav.tab.update" },
  { key: "coding", labelKey: "nav.tab.coding" },
  { key: "media", labelKey: "nav.tab.media" },
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
    case "media":
      return <MediaPanel />;
  }
}

export function AppShell() {
  const { t } = useTranslation();
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
    <main className="app-shell">
      <div
        className="app-nav"
        role="tablist"
        aria-label={t("nav.label")}
        onKeyDown={onKeyDown}
      >
        {TABS.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${tab.key}`}
            aria-controls={`panel-${tab.key}`}
            aria-selected={active === tab.key}
            tabIndex={active === tab.key ? 0 : -1}
            className={active === tab.key ? "app-tab is-active" : "app-tab"}
            onClick={() => setActive(tab.key)}
          >
            {t(tab.labelKey)}
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
    </main>
  );
}
