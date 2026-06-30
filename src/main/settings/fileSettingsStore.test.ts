import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSettingsStore } from "./fileSettingsStore";
import { DEFAULT_SETTINGS } from "@shared/settings/settings";

/**
 * 実保存 (JSON ファイル) の往復テスト。
 * パスは注入。main では app.getPath("userData") 配下を渡す前提。
 */

const dirs: string[] = [];
function tmpFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aika-settings-"));
  dirs.push(dir);
  return path.join(dir, "settings.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("FileSettingsStore", () => {
  it("未作成ファイルの read は null", async () => {
    const store = new FileSettingsStore(tmpFile());
    expect(await store.read()).toBeNull();
  });

  it("write した内容を read で取り出せる", async () => {
    const file = tmpFile();
    const store = new FileSettingsStore(file);
    await store.write({ ...DEFAULT_SETTINGS, theme: "dark" });
    const read = await store.read();
    expect(read).toMatchObject({ theme: "dark" });
  });
});
