import { describe, it, expect } from "vitest";
import { JobHistory, type JobHistoryEntry } from "./jobHistory";

/**
 * ジョブ履歴 (メモリ常駐) の契約テスト。
 * jobHistoryLimit に従う FIFO 管理、list は新しい順。
 */
function entry(jobId: string): JobHistoryEntry {
  return { jobId, state: "succeeded", artifacts: [`/a/${jobId}.png`] };
}

describe("JobHistory", () => {
  it("記録した順の逆 (新しい順) で list する", () => {
    const h = new JobHistory(10);
    h.record(entry("job-1"));
    h.record(entry("job-2"));
    expect(h.list().map((e) => e.jobId)).toEqual(["job-2", "job-1"]);
  });

  it("上限を超えると最古を FIFO で破棄する", () => {
    const h = new JobHistory(2);
    h.record(entry("job-1"));
    h.record(entry("job-2"));
    h.record(entry("job-3"));
    expect(h.list().map((e) => e.jobId)).toEqual(["job-3", "job-2"]);
    expect(h.size).toBe(2);
  });

  it("失敗ジョブも記録できる", () => {
    const h = new JobHistory(5);
    h.record({ jobId: "job-9", state: "failed", error: "boom" });
    const e = h.list()[0];
    expect(e?.state).toBe("failed");
    expect(e?.error).toBe("boom");
  });

  it("初期は空", () => {
    expect(new JobHistory(3).list()).toEqual([]);
  });
});
