import { existsSync, realpathSync, type RmOptions } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  CLEANUP_RM_OPTIONS,
  CLOSE_TIMEOUT_MS,
  EXIT_TIMEOUT_MS,
  USER_DATA_PREFIX,
  buildLaunchArgs,
  closeWithin,
  createUserDataDir,
  finalizeUserDataDir,
  tearDownLaunches,
  type Closable,
  type LaunchedApp,
  type LaunchRecord,
} from "./fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * E2E の userData 隔離 (#36)。
 *
 * 以前は21件中14件が --user-data-dir を渡さず、開発者の実際の userData に
 * 書き込んでいた。隔離を渡していた spec も一時ディレクトリを消していなかった。
 * ここでは launchApp の隔離と後片付けを固定する。
 */

/**
 * ウインドウが開き、画面が表示されるまで待つ。
 *
 * macOS の Electron は、ウインドウを作っている途中 (起動から約0.2秒) に終了させると
 * SIGSEGV で落ちる。落ちると macOS が異常終了を記録し、次の起動で「ウインドウを
 * 再開しますか」の確認が出て、他のテストの起動まで止まっていた。
 * アプリを閉じるテストは、既存の spec と同じく画面が出てから閉じる。
 */
async function waitUntilOpen(app: LaunchedApp["app"]): Promise<void> {
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "文章作成" })).toBeVisible({
    timeout: 15_000,
  });
}

test("isolation: アプリの userData は OS の一時ディレクトリ直下のテスト専用ディレクトリになる", async ({
  launchApp,
}) => {
  const { app, userDataDir } = await launchApp();
  await waitUntilOpen(app);

  const actual = await app.evaluate(({ app }) => app.getPath("userData"));
  expect(realpathSync(actual)).toBe(realpathSync(userDataDir));
  expect(path.dirname(realpathSync(userDataDir))).toBe(
    realpathSync(os.tmpdir()),
  );
  expect(path.basename(userDataDir).startsWith(USER_DATA_PREFIX)).toBe(true);

  await app.close();
});

test.describe("isolation: 成功したテストの後片付け", () => {
  // 後片付けは次のテストからしか観察できないため、順番に実行する。
  test.describe.configure({ mode: "serial" });

  let previous: { dirs: string[]; pid: number | undefined } | undefined;

  test("起動のたびに別の隔離ディレクトリを使い、開いたままのアプリも残す", async ({
    launchApp,
  }) => {
    const first = await launchApp({ settings: "{}" });
    await waitUntilOpen(first.app);
    await first.app.close();
    // 閉じずに終える。後片付けで閉じられることを次のテストで確かめる。
    const second = await launchApp();
    await waitUntilOpen(second.app);

    expect(second.userDataDir).not.toBe(first.userDataDir);
    expect(existsSync(first.userDataDir)).toBe(true);
    previous = {
      dirs: [first.userDataDir, second.userDataDir],
      pid: second.app.process().pid,
    };
  });

  test("前のテストの隔離ディレクトリは削除され、アプリも終了している", () => {
    expect(previous).toBeDefined();
    for (const dir of previous?.dirs ?? []) {
      expect(existsSync(dir)).toBe(false);
    }
    const pid = previous?.pid;
    expect(pid).toBeDefined();
    // シグナル 0 は存在確認だけを行う。終了していれば ESRCH で失敗する。
    expect(() => process.kill(pid as number, 0)).toThrow();
  });
});

async function seedUserData(): Promise<string> {
  const dir = await createUserDataDir(JSON.stringify({ theme: "dark" }));
  await writeFile(path.join(dir, "settings.json.bak"), "PREV");
  await writeFile(path.join(dir, "job-history.json"), "[]");
  await writeFile(path.join(dir, "settings.json.123-0123456789abcdef.tmp"), "TMP");
  await writeFile(path.join(dir, "Preferences"), "{}");
  await mkdir(path.join(dir, "Code Cache"));
  await writeFile(path.join(dir, "Code Cache", "entry"), "cache");
  // 読取専用のテスト (settings(persist)) の後でも片付けられること。
  await chmod(path.join(dir, "settings.json"), 0o444);
  return dir;
}

test("isolation: 失敗したテストはアプリのファイルだけを診断用に残し、隔離ディレクトリは消す", async ({}, testInfo) => {
  const dir = await seedUserData();
  const keepTo = testInfo.outputPath("kept");

  await finalizeUserDataDir(dir, { failed: true, keepTo });

  expect(existsSync(dir)).toBe(false);
  expect((await readdir(keepTo)).sort()).toEqual([
    "job-history.json",
    "settings.json",
    "settings.json.123-0123456789abcdef.tmp",
    "settings.json.bak",
  ]);
  expect(await readFile(path.join(keepTo, "settings.json.bak"), "utf-8")).toBe(
    "PREV",
  );
});

test("isolation: 成功したテストは何も残さず、再試行付きの削除を使う", async ({}, testInfo) => {
  const dir = await seedUserData();
  const keepTo = testInfo.outputPath("kept");
  const calls: [string, RmOptions][] = [];

  await finalizeUserDataDir(dir, {
    failed: false,
    keepTo,
    remove: async (target, options) => {
      calls.push([target, options]);
      await rm(target, options);
    },
  });

  expect(existsSync(dir)).toBe(false);
  expect(existsSync(keepTo)).toBe(false);
  expect(calls).toEqual([[dir, CLEANUP_RM_OPTIONS]]);
  // Windows で Electron の子プロセスがファイルを掴んでいる間も消せるように。
  expect(CLEANUP_RM_OPTIONS.maxRetries).toBeGreaterThan(0);
  expect(CLEANUP_RM_OPTIONS.retryDelay).toBeGreaterThan(0);
});

test("isolation: spec は共通フィクスチャ経由でだけアプリを起動する", async () => {
  // Playwright から直接 import すると、隔離を経ずに Electron を起動できてしまう。
  const direct = /from\s+["']@playwright\/test["']/;
  const offenders: string[] = [];
  for (const name of await readdir(here)) {
    if (!name.endsWith(".spec.ts")) continue;
    const source = await readFile(path.join(here, name), "utf-8");
    if (direct.test(source)) offenders.push(name);
  }
  expect(offenders).toEqual([]);
});

test("isolation: macOS の再開確認を抑える引数は、macOS のテスト起動にだけ付ける", () => {
  const mac = buildLaunchArgs("/tmp/aika-e2e-x", "darwin");
  expect(mac).toContain("--user-data-dir=/tmp/aika-e2e-x");
  expect(mac.slice(-2)).toEqual(["-ApplePersistenceIgnoreState", "YES"]);

  for (const platform of ["linux", "win32"] as const) {
    const args = buildLaunchArgs("/tmp/aika-e2e-x", platform);
    expect(args).toContain("--user-data-dir=/tmp/aika-e2e-x");
    expect(args.filter((a) => a.includes("ApplePersistence"))).toEqual([]);
    expect(args).not.toContain("YES");
  }
});

/** 終了の振る舞いを選べる偽のアプリ。Electron は起動しない。 */
function fakeApp(
  behavior: "closes" | "hangs" | "rejects",
  options: { exitsOnKill: boolean } = { exitsOnKill: true },
) {
  let kills = 0;
  let exit: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const closable: Closable = {
    close: () =>
      behavior === "closes"
        ? Promise.resolve()
        : behavior === "rejects"
          ? Promise.reject(new Error("boom"))
          : new Promise<void>(() => {}),
    kill: () => {
      kills += 1;
      if (options.exitsOnKill) exit();
    },
    exited: () => exited,
  };
  return { closable, kills: () => kills };
}

const FAST = { closeMs: 50, exitMs: 50 };

test.describe("isolation: 終了待ちの上限", () => {
  test("上限は 10 秒、強制終了後の待ちは 5 秒", () => {
    expect(CLOSE_TIMEOUT_MS).toBe(10_000);
    expect(EXIT_TIMEOUT_MS).toBe(5_000);
  });

  test("閉じたアプリは強制終了しない", async () => {
    const app = fakeApp("closes");
    expect(await closeWithin(app.closable, FAST)).toEqual({ status: "closed" });
    expect(app.kills()).toBe(0);
  });

  test("上限までに閉じなければ強制終了し、終了を待って戻る", async () => {
    const app = fakeApp("hangs");
    const started = Date.now();
    const result = await closeWithin(app.closable, FAST);
    const elapsed = Date.now() - started;

    expect(result).toEqual({
      status: "killed",
      reason: "app did not close within 50ms",
    });
    expect(app.kills()).toBe(1);
    // 上限を待ってから、上限の合計を大きく超えずに戻る。
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(1_000);
  });

  test("close() が失敗したときも強制終了する", async () => {
    const app = fakeApp("rejects");
    const result = await closeWithin(app.closable, FAST);
    expect(result.status).toBe("killed");
    expect(app.kills()).toBe(1);
  });

  test("強制終了しても終わらなければ失敗を返す", async () => {
    const app = fakeApp("hangs", { exitsOnKill: false });
    await expect(closeWithin(app.closable, FAST)).rejects.toThrow(
      "the process did not exit within 50ms after kill",
    );
    expect(app.kills()).toBe(1);
  });
});

test("isolation: 強制終了が起きたテストは失敗とし、userData と Electron の出力を残して隔離ディレクトリを消す", async ({}, testInfo) => {
  const dir = await seedUserData();
  const record: LaunchRecord = {
    userDataDir: dir,
    closable: fakeApp("hangs").closable,
    isClosed: () => false,
    output: ["[electron] started\n"],
  };

  await expect(
    tearDownLaunches([record], {
      testFailed: false,
      outputPath: (name) => testInfo.outputPath("teardown", name),
      limits: FAST,
    }),
  ).rejects.toThrow("app did not close within 50ms; killed");

  expect(existsSync(dir)).toBe(false);
  expect(
    await readFile(
      testInfo.outputPath("teardown", "electron-output.txt"),
      "utf-8",
    ),
  ).toBe("[electron] started\n");
  expect(await readdir(testInfo.outputPath("teardown", "user-data"))).toContain(
    "settings.json",
  );
});

test("isolation: 通常に閉じた成功テストは、診断用のファイルを残さず隔離ディレクトリを消す", async ({}, testInfo) => {
  const dir = await seedUserData();
  const record: LaunchRecord = {
    userDataDir: dir,
    closable: fakeApp("closes").closable,
    isClosed: () => false,
    output: ["[electron] started\n"],
  };

  await tearDownLaunches([record], {
    testFailed: false,
    outputPath: (name) => testInfo.outputPath("teardown", name),
    limits: FAST,
  });

  expect(existsSync(dir)).toBe(false);
  expect(existsSync(testInfo.outputPath("teardown"))).toBe(false);
});
