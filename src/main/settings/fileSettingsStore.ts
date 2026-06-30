import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, SettingsStore } from "@shared/settings/settings";

/**
 * JSON ファイルによる SettingsStore 実装。
 *
 * filePath は注入する。main では app.getPath("userData") 配下を渡し、
 * ユーザー設定領域に保存する (テストでは一時ファイルを渡す)。
 *
 * 注意: 機密情報は保存しない (settings.ts の方針参照)。
 */
export class FileSettingsStore implements SettingsStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Record<string, unknown> | null> {
    try {
      const text = await readFile(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async write(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(settings, null, 2),
      "utf-8",
    );
  }
}
