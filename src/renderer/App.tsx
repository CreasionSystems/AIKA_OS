import { WritingPanel } from "./components/WritingPanel";

/** renderer ルート。当面は文章作成画面のみ。 */
export function App() {
  return (
    <main>
      <WritingPanel />
    </main>
  );
}
