import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  JobHistoryEntry,
  JobHistoryStore,
} from "@shared/jobs/jobHistory";

/**
 * JSON ファイルによる JobHistoryStore 実装。
 *
 * filePath は注入する。main では app.getPath("userData") 配下を渡す。
 * 破損/未作成時は空配列で復帰する (履歴は失っても致命でないため寛容)。
 */
export class FileJobHistoryStore implements JobHistoryStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<JobHistoryEntry[]> {
    try {
      const text = await readFile(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as JobHistoryEntry[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      return [];
    }
  }

  async save(entries: JobHistoryEntry[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf-8");
  }
}
