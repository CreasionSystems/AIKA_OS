import { describe, it, expect } from "vitest";
import {
  JobHistory,
  MemoryJobHistoryStore,
  type JobHistoryEntry,
} from "./jobHistory";

/**
 * ジョブ履歴の契約テスト。
 * jobHistoryLimit に従う FIFO 管理、list は新しい順、ストア連携で永続化。
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

describe("JobHistory (ストア連携)", () => {
  it("MemoryJobHistoryStore は save した内容を load で返す", async () => {
    const store = new MemoryJobHistoryStore();
    await store.save([entry("1"), entry("2")]);
    expect((await store.load()).map((e) => e.jobId)).toEqual(["1", "2"]);
  });

  it("init で永続値を上限内 (最新側) に読み込む", async () => {
    const store = new MemoryJobHistoryStore([
      entry("1"),
      entry("2"),
      entry("3"),
    ]);
    const h = new JobHistory(2, store);
    await h.init();
    expect(h.list().map((e) => e.jobId)).toEqual(["3", "2"]);
  });

  it("record で store に永続化する", async () => {
    const store = new MemoryJobHistoryStore();
    const h = new JobHistory(5, store);
    h.record(entry("1"));
    h.record(entry("2"));
    await h.whenIdle();
    expect((await store.load()).map((e) => e.jobId)).toEqual(["1", "2"]);
  });

  it("store 無しでも従来どおり動く", () => {
    const h = new JobHistory(2);
    h.record(entry("1"));
    expect(h.list().map((e) => e.jobId)).toEqual(["1"]);
  });
});
