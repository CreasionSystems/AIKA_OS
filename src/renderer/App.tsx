import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { initLanguageFromSettings } from "./i18n";

/** renderer ルート。タブ式の画面シェル。起動時に保存言語を反映する。 */
export function App() {
  useEffect(() => {
    void initLanguageFromSettings();
  }, []);
  return <AppShell />;
}
