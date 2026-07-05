import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import i18n from "@renderer/i18n";

// テスト間で言語をリセット (既定は日本語)。
afterEach(async () => {
  if (i18n.language !== "ja") await i18n.changeLanguage("ja");
});
