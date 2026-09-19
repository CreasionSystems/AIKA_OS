import { describe, it, expect } from "vitest";

/**
 * テスト実行環境の割り当て (vitest.config.ts の projects)。
 *
 * main / shared / preload のテスト (.ts) は node で動かす。jsdom で動くと
 * window や document が存在してしまい、main プロセスに無い API へ依存した
 * コードでもテストが通ってしまう。Vitest 4 で environmentMatchGlobs が廃止され
 * projects へ移行したため、割り当てが崩れていないことを固定する。
 */
describe("テスト実行環境 (.ts)", () => {
  it("node で動き、DOM を持たない", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof process.versions.node).toBe("string");
  });

  it("共通の setupFiles が適用されている", () => {
    // vitest.setup.ts が登録する jest-dom のマッチャ。
    expect(typeof expect(null).toBeInTheDocument).toBe("function");
  });
});
