import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import type { RmOptions } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * E2E の共通フィクスチャ (#36)。
 *
 * アプリは必ず launchApp で起動し、テストごとに専用の userData を渡す。
 * --user-data-dir は Chromium 標準のスイッチで app.getPath("userData") が従うため、
 * アプリ側にテスト専用の注入口・環境変数・IPC channel は要らない。
 * 以前は大半の spec がこれを渡さず、開発者の実際の userData に書き込んでいた。
 */

/** 隔離ディレクトリの接頭辞。OS の一時ディレクトリの直下に作る。 */
export const USER_DATA_PREFIX = "aika-e2e-";

/**
 * 失敗時に診断用として残すアプリのファイル。
 * Chromium のキャッシュ類は残さない。量が多く、パスも長い。
 */
export const APP_FILE_PATTERN =
  /^(?:settings\.json(?:\.bak|\..+\.tmp)?|job-history\.json)$/;

/**
 * 隔離ディレクトリの削除。
 *
 * Windows では、Electron の子プロセスが終了した直後もしばらくファイルを掴んでいて
 * EBUSY / EPERM になることがある。Node の rm の再試行 (EBUSY / EMFILE / ENFILE /
 * ENOTEMPTY / EPERM が対象、待ち時間は retryDelay ずつ延びる) で吸収する。
 * 再試行しても消せなければ例外のまま投げ、テストを失敗させる。
 */
export const CLEANUP_RM_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
} as const satisfies RmOptions;

/**
 * OS の一時ディレクトリの下に隔離ディレクトリを作る。
 *
 * 失敗時の保存先 (test-results/<テスト名>/) に直接置かないのは、Windows で
 * Chromium のキャッシュのパスが MAX_PATH (260文字) に迫るため。
 */
export async function createUserDataDir(settings?: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), USER_DATA_PREFIX));
  if (settings !== undefined) {
    await writeFile(path.join(dir, "settings.json"), settings, "utf-8");
  }
  return dir;
}

/**
 * テストが終わった隔離ディレクトリを片付ける。
 * 失敗したテストでは、先にアプリのファイルだけを keepTo へ写す。
 */
export async function finalizeUserDataDir(
  dir: string,
  options: {
    failed: boolean;
    keepTo: string;
    remove?: (dir: string, options: RmOptions) => Promise<void>;
  },
): Promise<void> {
  const remove = options.remove ?? rm;
  if (options.failed) {
    await mkdir(options.keepTo, { recursive: true });
    for (const name of await readdir(dir)) {
      if (!APP_FILE_PATTERN.test(name)) continue;
      // copyFile は mode も写すため、読取専用のテストの後に残すと
      // test-results の掃除で困る。中身だけを写す。
      const body = await readFile(path.join(dir, name));
      await writeFile(path.join(options.keepTo, name), body);
    }
  }
  await remove(dir, CLEANUP_RM_OPTIONS);
}

/** app.close() を待つ上限。通常の終了は1秒未満で終わる。 */
export const CLOSE_TIMEOUT_MS = 10_000;

/** 強制終了したあと、プロセスの終了を待つ上限。 */
export const EXIT_TIMEOUT_MS = 5_000;

/** Electron の出力を診断用に残す上限 (末尾を残す)。 */
const OUTPUT_LIMIT_CHARS = 1_000_000;

/**
 * Electron の起動引数を組み立てる。
 *
 * macOS は、前回の Electron が異常終了したことを覚えていると、起動時に
 * 「ウインドウを再開しますか」の確認を出し、応答があるまでウインドウを作らない
 * (firstWindow が待ち続ける)。E2E の起動に限り、保存済みのウインドウ状態を
 * 無視させる。製品の起動には付けない。Linux / Windows にはこの仕組みが無い。
 */
export function buildLaunchArgs(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const args = [
    mainEntry,
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
    "--disable-gpu",
    "--lang=ja",
  ];
  if (platform === "darwin") {
    args.push("-ApplePersistenceIgnoreState", "YES");
  }
  return args;
}

/** 閉じる対象。ElectronApplication とそのプロセスを包む。 */
export interface Closable {
  close(): Promise<void>;
  kill(): void;
  exited(): Promise<void>;
}

export type CloseResult =
  | { status: "closed" }
  | { status: "killed"; reason: string };

const TIMED_OUT = Symbol("timed out");

async function within<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 上限時間の中でアプリを閉じる。閉じなければ強制終了し、プロセスの終了を待つ。
 *
 * 起動の途中で止まったアプリ (macOS の再開の確認など) は app.close() から
 * 戻ってこない。以前はここで後片付けが止まり、隔離ディレクトリが残ったうえ、
 * ワーカーごと強制終了されていた。
 */
export async function closeWithin(
  target: Closable,
  limits: { closeMs: number; exitMs: number } = {
    closeMs: CLOSE_TIMEOUT_MS,
    exitMs: EXIT_TIMEOUT_MS,
  },
): Promise<CloseResult> {
  // 期限を過ぎた後に close() が失敗しても未処理の reject にならないよう、
  // 結果を値として受け取る。
  const closing = target.close().then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  const outcome = await within(closing, limits.closeMs);
  if (outcome !== TIMED_OUT && outcome.ok) return { status: "closed" };

  const reason =
    outcome === TIMED_OUT
      ? `app did not close within ${limits.closeMs}ms`
      : `app.close() failed: ${String(outcome.err)}`;
  target.kill();
  if ((await within(target.exited(), limits.exitMs)) === TIMED_OUT) {
    throw new Error(
      `${reason}; the process did not exit within ${limits.exitMs}ms after kill`,
    );
  }
  return { status: "killed", reason };
}

function closableOf(app: ElectronApplication): Closable {
  const proc = app.process();
  return {
    close: () => app.close(),
    // Windows では Node の kill が TerminateProcess になる。
    kill: () => {
      proc.kill("SIGKILL");
    },
    exited: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            proc.once("exit", () => resolve());
          }),
  };
}

/** 1回の起動の記録。起動に失敗しても片付けられるよう、起動より前に作る。 */
export interface LaunchRecord {
  userDataDir: string;
  closable?: Closable;
  isClosed: () => boolean;
  output: string[];
}

/**
 * テストの後片付け。アプリをすべて閉じてから、隔離ディレクトリを片付ける。
 *
 * 強制終了が起きたテストは失敗として扱い、アプリのファイルと Electron の出力を
 * 診断用に残す。1件の片付けに失敗しても残りを片付け、最初の例外をあとで投げる。
 */
export async function tearDownLaunches(
  launches: readonly LaunchRecord[],
  context: {
    testFailed: boolean;
    outputPath: (name: string) => string;
    /** 回帰テスト用。既定は CLOSE_TIMEOUT_MS / EXIT_TIMEOUT_MS。 */
    limits?: { closeMs: number; exitMs: number };
  },
): Promise<void> {
  const errors: unknown[] = [];

  for (const launch of launches) {
    if (launch.closable === undefined || launch.isClosed()) continue;
    try {
      const result = await closeWithin(launch.closable, context.limits);
      if (result.status === "killed") {
        errors.push(new Error(`${result.reason}; killed`));
      }
    } catch (err) {
      errors.push(err);
    }
  }

  const failed = context.testFailed || errors.length > 0;
  for (const [index, launch] of launches.entries()) {
    const suffix = launches.length > 1 ? `-${index + 1}` : "";
    try {
      if (failed) {
        const file = context.outputPath(`electron-output${suffix}.txt`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, launch.output.join(""));
      }
      await finalizeUserDataDir(launch.userDataDir, {
        failed,
        keepTo: context.outputPath(`user-data${suffix}`),
      });
    } catch (err) {
      errors.push(err);
    }
  }

  if (errors.length > 0) throw errors[0];
}

function recordOutput(app: ElectronApplication, output: string[]): void {
  let size = 0;
  const push = (chunk: Buffer | string) => {
    const text = chunk.toString();
    output.push(text);
    size += text.length;
    while (size > OUTPUT_LIMIT_CHARS && output.length > 1) {
      size -= (output.shift() ?? "").length;
    }
  };
  const proc = app.process();
  proc.stdout?.on("data", push);
  proc.stderr?.on("data", push);
}

export interface LaunchOptions {
  /** 起動前に settings.json として置く内容。 */
  settings?: string;
}

export interface LaunchedApp {
  app: ElectronApplication;
  userDataDir: string;
  settingsFile: string;
}

export type LaunchApp = (options?: LaunchOptions) => Promise<LaunchedApp>;

export const test = base.extend<{ launchApp: LaunchApp }>({
  launchApp: async ({}, use, testInfo) => {
    const launches: LaunchRecord[] = [];

    await use(async (options = {}) => {
      const userDataDir = await createUserDataDir(options.settings);
      let closed = false;
      const launch: LaunchRecord = {
        userDataDir,
        isClosed: () => closed,
        output: [],
      };
      launches.push(launch);
      const app = await electron.launch({
        args: buildLaunchArgs(userDataDir),
      });
      launch.closable = closableOf(app);
      app.on("close", () => {
        closed = true;
      });
      recordOutput(app, launch.output);
      return {
        app,
        userDataDir,
        settingsFile: path.join(userDataDir, "settings.json"),
      };
    });

    // テストが途中で失敗しても、アプリを閉じてから隔離ディレクトリを片付ける。
    await tearDownLaunches(launches, {
      testFailed: testInfo.status !== testInfo.expectedStatus,
      outputPath: (name) => testInfo.outputPath(name),
    });
  },
});

export { expect };
