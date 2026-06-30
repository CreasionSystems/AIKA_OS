import { WritingPanel } from "./components/WritingPanel";
import { SettingsPanel } from "./components/SettingsPanel";

/** renderer ルート。当面は文章作成 + 設定画面。 */
export function App() {
  return (
    <main>
      <WritingPanel />
      <SettingsPanel />
    </main>
  );
}
