import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@renderer/i18n";

/**
 * テスト実行環境の割り当て (vitest.config.ts の projects)。
 *
 * renderer のテスト (.tsx) は jsdom で動かす。Vitest 4 で environmentMatchGlobs が
 * 廃止され projects へ移行したため、割り当てと、共通設定 (alias / setupFiles) の
 * 引き継ぎが崩れていないことを固定する。
 */
describe("テスト実行環境 (.tsx)", () => {
  it("jsdom で動き、DOM を描画できる", () => {
    expect(navigator.userAgent).toContain("jsdom");
    render(<p>environment</p>);
    expect(screen.getByText("environment")).toBeInTheDocument();
  });

  it("共通の setupFiles と alias が適用されている", () => {
    // vitest.setup.ts が各テストの後に日本語へ戻す。@renderer の alias で読める。
    expect(i18n.language).toBe("ja");
  });
});
