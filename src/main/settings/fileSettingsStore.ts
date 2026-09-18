import { readFile } from "node:fs/promises";
import type {
  AppSettings,
  SettingsReadFailure,
  SettingsReadResult,
  SettingsStore,
} from "@shared/settings/settings";
import { writeFileAtomic } from "./atomicFileWriter";

/** Node の例外を読み取り失敗の分類へ写す。 */
function classify(err: unknown): SettingsReadFailure {
  // JSON の失敗は code を持たないため、型で判定する。
  if (err instanceof SyntaxError) return "malformed";
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") return "permission";
  if (code === "EISDIR") return "not-a-file";
  return "io";
}

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

  async read(): Promise<SettingsReadResult> {
    try {
      const text = await readFile(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(text);
      // 配列も typeof "object" なので個別に弾く。以前は配列がそのまま通り、
      // 全項目が既定値へ落ちたうえで次回保存時に上書きされていた。
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return { status: "loaded", raw: parsed as Record<string, unknown> };
      }
      // 解析はできたが設定オブジェクトではない (配列 / 文字列 / 数値 / null)。
      // 中身を使えない以上、既定値で開いて上書きするより読めない扱いが安全。
      return { status: "unreadable", failure: "malformed" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing" };
      }
      return { status: "unreadable", failure: classify(err) };
    }
  }

  /**
   * 置き換えは atomic に行い、直前の内容を 1世代だけ残す (#33)。
   * 以前は writeFile で同じファイルを切り詰めて書き直しており、途中で失敗すると
   * 空や途中までの JSON が残って、次回起動時に読めない設定になっていた (#31)。
   */
  async write(settings: AppSettings): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(settings, null, 2), {
      backupPath: `${this.filePath}.bak`,
    });
  }
}
