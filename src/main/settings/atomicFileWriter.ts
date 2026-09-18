import * as nodeFs from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * 書き込みに使う fs 操作。テストで失敗を差し込めるよう注入可能にする。
 * クラッシュそのものは再現できないため、各段階での失敗で代わりに検証する。
 */
export interface AtomicWriteFs {
  mkdir: typeof nodeFs.mkdir;
  open: typeof nodeFs.open;
  stat: typeof nodeFs.stat;
  access: typeof nodeFs.access;
  copyFile: typeof nodeFs.copyFile;
  rename: typeof nodeFs.rename;
  unlink: typeof nodeFs.unlink;
  readdir: typeof nodeFs.readdir;
}

const defaultFs: AtomicWriteFs = {
  mkdir: nodeFs.mkdir,
  open: nodeFs.open,
  stat: nodeFs.stat,
  access: nodeFs.access,
  copyFile: nodeFs.copyFile,
  rename: nodeFs.rename,
  unlink: nodeFs.unlink,
  readdir: nodeFs.readdir,
};

export interface AtomicWriteOptions {
  /** 指定すると、置き換える直前に既存ファイルをここへコピーする (1世代)。 */
  backupPath?: string;
  /**
   * Windows で rename が一時的に失敗したときの再試行。
   * アンチウイルスやインデクサがファイルを掴んでいると EPERM / EBUSY になる。
   */
  retry?: { attempts: number; initialDelayMs: number };
  /** この時間より古い、クラッシュで残った一時ファイルを掃除する (ms)。 */
  staleTempMs?: number;
  /** テスト用。プラットフォーム依存の分岐を再現する。 */
  platform?: NodeJS.Platform;
  /** テスト用。再試行の待ちを短絡する。 */
  sleep?: (ms: number) => Promise<void>;
  /** テスト用。現在時刻 (ms)。 */
  now?: () => number;
}

const DEFAULT_RETRY = { attempts: 5, initialDelayMs: 10 };
const DEFAULT_STALE_TEMP_MS = 10 * 60 * 1000;

/** Windows で rename を再試行してよい一時的な失敗。 */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fs が返す Error の形を保ったまま、code 付きの失敗を作る。 */
function fsError(code: string, message: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(message);
  err.code = code;
  return err;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 一時ファイル名。同じディレクトリに置かないと rename が atomic にならない。 */
function tempNameFor(file: string): string {
  const suffix = `${process.pid}-${randomBytes(8).toString("hex")}.tmp`;
  return `${file}.${suffix}`;
}

/**
 * クラッシュで残った一時ファイルを掃除する (best effort)。
 * 同時に走っている保存の一時ファイルを消さないよう、十分古いものだけを対象にする。
 */
async function removeStaleTemps(
  fs: AtomicWriteFs,
  file: string,
  staleMs: number,
  now: number,
): Promise<void> {
  const dir = path.dirname(file);
  const pattern = new RegExp(
    `^${escapeRegExp(path.basename(file))}\\.\\d+-[0-9a-f]{16}\\.tmp$`,
  );
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const candidate = path.join(dir, name);
    try {
      const st = await fs.stat(candidate);
      if (st.isFile() && now - st.mtimeMs > staleMs) {
        await fs.unlink(candidate);
      }
    } catch {
      // 掃除の失敗は保存の成否に影響させない。
    }
  }
}

async function renameWithRetry(
  fs: AtomicWriteFs,
  from: string,
  to: string,
  platform: NodeJS.Platform,
  retry: { attempts: number; initialDelayMs: number },
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let delay = retry.initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const transient =
        platform === "win32" && TRANSIENT_RENAME_CODES.has(codeOf(err) ?? "");
      if (!transient || attempt >= retry.attempts) throw err;
      await sleep(delay);
      delay *= 2;
    }
  }
}

/** rename を永続化するためディレクトリを fsync する (best effort)。 */
async function syncDirectory(
  fs: AtomicWriteFs,
  dir: string,
  platform: NodeJS.Platform,
): Promise<void> {
  // Windows ではディレクトリを開いて fsync できない。
  if (platform === "win32") return;
  try {
    const handle = await fs.open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // 置き換え自体は終わっている。永続性の補強に失敗しても成功扱いにする。
  }
}

/**
 * ファイルを atomic に置き換える (#33)。
 *
 * writeFile は同じ inode を切り詰めてから書き直すため、途中でクラッシュや
 * ディスクフルが起きると空または途中までの JSON が残り、次回の読み込みで
 * 壊れた設定になる。ここでは同じディレクトリの一時ファイルに書き切って
 * fsync してから rename する。途中で失敗しても、対象は旧内容のまま残る。
 *
 * 既存ファイルについては次を守る。
 * - 読取専用なら従来どおり失敗させる。rename はディレクトリの権限しか見ないため、
 *   確認しないと利用者が意図して読取専用にしたファイルを黙って置き換えてしまう
 * - mode を一時ファイルへ引き継ぐ。rename で入れ替わるのは新しい inode なので、
 *   引き継がないと権限が umask 次第で変わってしまう
 * - backupPath があれば置き換える直前にコピーする。コピーに失敗したら保存を中止する
 *
 * 失敗は Node の例外のまま投げる。IPC 境界で意味 ID へ変換され、パスや code が
 * renderer に渡ることはない。
 */
export async function writeFileAtomic(
  file: string,
  data: string,
  options: AtomicWriteOptions = {},
  fs: AtomicWriteFs = defaultFs,
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const retry = options.retry ?? DEFAULT_RETRY;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const dir = path.dirname(file);

  await fs.mkdir(dir, { recursive: true });

  // 既存ファイルの確認。書けないものは一時ファイルもバックアップも作らずに止める。
  let existingMode: number | undefined;
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) {
      throw fsError("EISDIR", "illegal operation on a directory");
    }
    await fs.access(file, constants.W_OK);
    existingMode = st.mode & 0o777;
  } catch (err) {
    if (codeOf(err) !== "ENOENT") throw err;
  }

  await removeStaleTemps(
    fs,
    file,
    options.staleTempMs ?? DEFAULT_STALE_TEMP_MS,
    now(),
  );

  const tmp = tempNameFor(file);
  let renamed = false;
  try {
    // "wx" で作り、同名があれば上書きせずに失敗させる。
    const handle = await fs.open(tmp, "wx");
    try {
      await handle.writeFile(data, "utf-8");
      if (existingMode !== undefined) {
        // open の mode は umask の影響を受けるため、chmod で正確に合わせる。
        await handle.chmod(existingMode);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (options.backupPath !== undefined && existingMode !== undefined) {
      await fs.copyFile(file, options.backupPath);
    }

    await renameWithRetry(fs, tmp, file, platform, retry, sleep);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        await fs.unlink(tmp);
      } catch {
        // 作成前に失敗した場合など、消すものが無いこともある。
      }
    }
  }

  await syncDirectory(fs, dir, platform);
}
