import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileJobHistoryStore } from "./fileJobHistoryStore";
import type { JobHistoryEntry } from "@shared/jobs/jobHistory";

const dirs: string[] = [];
function tmpFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aika-jobhist-"));
  dirs.push(dir);
  return path.join(dir, "job-history.json");
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const entries: JobHistoryEntry[] = [
  { jobId: "job-1", state: "succeeded", artifacts: ["/a/1.png"] },
  { jobId: "job-2", state: "failed", error: "x" },
];

describe("FileJobHistoryStore", () => {
  it("未作成ファイルの load は空配列", async () => {
    const store = new FileJobHistoryStore(tmpFile());
    expect(await store.load()).toEqual([]);
  });

  it("save した内容を load で取り出せる (往復)", async () => {
    const file = tmpFile();
    const store = new FileJobHistoryStore(file);
    await store.save(entries);
    const read = await store.load();
    expect(read.map((e) => e.jobId)).toEqual(["job-1", "job-2"]);
  });
});
