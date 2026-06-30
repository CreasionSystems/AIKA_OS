import { describe, it, expect } from "vitest";
import { JobQueue } from "./jobQueue";

/**
 * 共通ジョブ管理 (最小) の契約テスト。
 *
 * 契約:
 *  - enqueue(task) -> jobId、初期状態は "queued"
 *  - 状態遷移: queued -> running -> succeeded | failed
 *  - getJob(id) で現在状態を取得、未知 id は undefined
 *  - タイムスタンプは注入クロックで決定的に検証
 *
 * 決定性: クロックを注入し、タスクは deferred promise で外部から解決/拒否する。
 */

/** 外部から resolve/reject できる promise。 */
function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** マクロタスク境界まで待ち、保留中のマイクロタスクを確実に流す。 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 1ずつ増える決定的クロック。 */
function makeClock(start = 0) {
  let t = start;
  return () => ++t;
}

function makeSeqIdFactory() {
  let n = 0;
  return () => `job-${++n}`;
}

function makeQueue() {
  return new JobQueue({ now: makeClock(), idFactory: makeSeqIdFactory() });
}

describe("enqueue / getJob", () => {
  it("enqueue は jobId を返し、初期状態は queued", () => {
    const q = makeQueue();
    const id = q.enqueue(() => makeDeferred<string>().promise);
    expect(id).toBe("job-1");
    expect(q.getJob(id)?.state).toBe("queued");
  });

  it("未知の id は undefined", () => {
    const q = makeQueue();
    expect(q.getJob("nope")).toBeUndefined();
  });
});

describe("状態遷移: queued -> running -> succeeded", () => {
  it("処理開始で running、解決で succeeded と result を持つ", async () => {
    const q = makeQueue();
    const d = makeDeferred<string>();
    const id = q.enqueue(() => d.promise);

    expect(q.getJob(id)?.state).toBe("queued");

    await nextTick(); // 処理開始
    expect(q.getJob(id)?.state).toBe("running");

    d.resolve("RESULT");
    await q.whenSettled(id);

    const job = q.getJob<string>(id);
    expect(job?.state).toBe("succeeded");
    expect(job?.result).toBe("RESULT");
  });
});

describe("状態遷移: queued -> running -> failed", () => {
  it("タスクが reject すると failed と error メッセージを持つ", async () => {
    const q = makeQueue();
    const d = makeDeferred<string>();
    const id = q.enqueue(() => d.promise);

    await nextTick();
    expect(q.getJob(id)?.state).toBe("running");

    d.reject(new Error("boom"));
    await q.whenSettled(id);

    const job = q.getJob(id);
    expect(job?.state).toBe("failed");
    expect(job?.error).toContain("boom");
    expect(job?.result).toBeUndefined();
  });
});

describe("タイムスタンプ (注入クロック)", () => {
  it("createdAt <= startedAt <= finishedAt が単調", async () => {
    const q = makeQueue();
    const d = makeDeferred<number>();
    const id = q.enqueue(() => d.promise);

    await nextTick();
    d.resolve(1);
    await q.whenSettled(id);

    const job = q.getJob(id)!;
    expect(job.createdAt).toBeLessThanOrEqual(job.startedAt!);
    expect(job.startedAt!).toBeLessThanOrEqual(job.finishedAt!);
  });
});

describe("list", () => {
  it("登録済みジョブを列挙する", async () => {
    const q = makeQueue();
    q.enqueue(() => Promise.resolve("a"));
    q.enqueue(() => Promise.resolve("b"));
    expect(q.list().length).toBe(2);
  });
});
