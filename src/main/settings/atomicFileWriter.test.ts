import { describe, it, expect, afterEach } from "vitest";
import * as nodeFs from "node:fs/promises";
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomic, type AtomicWriteFs } from "./atomicFileWriter";

/**
 * ファイルの atomic な置き換え (#33)。
 *
 * クラッシュそのものは再現できないため、各段階で失敗を差し込み、
 * 「対象が旧内容のまま」「一時ファイルが残らない」ことで代わりに確かめる。
 */

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aika-atomic-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    // 権限を戻してから消す (読取専用ディレクトリのテストがあるため)。
    try {
      chmodSync(d, 0o755);
      for (const name of readdirSync(d)) {
        try {
          chmodSync(path.join(d, name), 0o755);
        } catch {
          // 消える途中のファイルは無視する。
        }
      }
    } catch {
      // 既に無い。
    }
    rmSync(d, { recursive: true, force: true });
  }
});

/** 対象と同じディレクトリに残っている一時ファイル。 */
function tempsIn(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(".tmp"));
}

function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
}

const realFs: AtomicWriteFs = {
  mkdir: nodeFs.mkdir,
  open: nodeFs.open,
  stat: nodeFs.stat,
  access: nodeFs.access,
  copyFile: nodeFs.copyFile,
  rename: nodeFs.rename,
  unlink: nodeFs.unlink,
  readdir: nodeFs.readdir,
};

function errno(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`${code}: injected`);
  err.code = code;
  return err;
}

/** 待たない sleep。呼ばれた待ち時間を記録する。 */
function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe("writeFileAtomic: 正常系", () => {
  it("内容を置き換え、一時ファイルを残さない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");

    await writeFileAtomic(file, "NEW");

    expect(readFileSync(file, "utf-8")).toBe("NEW");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("ディレクトリが無ければ作る", async () => {
    const file = path.join(tmpDir(), "nested", "deeper", "settings.json");
    await writeFileAtomic(file, "NEW");
    expect(readFileSync(file, "utf-8")).toBe("NEW");
  });

  it("置き換えは新しい inode になる (切り詰めて書き直さない)", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    const before = statSync(file).ino;
    await writeFileAtomic(file, "NEW");
    expect(statSync(file).ino).not.toBe(before);
  });
});

describe("writeFileAtomic: バックアップ", () => {
  it("初回 (対象なし) はバックアップを作らない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    await writeFileAtomic(file, "NEW", { backupPath: `${file}.bak` });
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("既存があれば置き換え前の内容を .bak に残す", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    await writeFileAtomic(file, "NEW", { backupPath: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf-8")).toBe("OLD");
    expect(readFileSync(file, "utf-8")).toBe("NEW");
  });

  it("バックアップは 1世代だけで、次の保存で上書きされる", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "V1");
    await writeFileAtomic(file, "V2", { backupPath: `${file}.bak` });
    await writeFileAtomic(file, "V3", { backupPath: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf-8")).toBe("V2");
    expect(readdirSync(dir).sort()).toEqual(["settings.json", "settings.json.bak"]);
  });

  it("読めない JSON もバイト列のまま退避できる", async () => {
    const file = path.join(tmpDir(), "settings.json");
    const broken = '{ "theme": "dark", ';
    writeFileSync(file, broken);
    await writeFileAtomic(file, "{}", { backupPath: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf-8")).toBe(broken);
  });

  it("backupPath が無ければバックアップを作らない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    await writeFileAtomic(file, "NEW");
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });
});

/**
 * Windows には POSIX の mode が無い。chmod は読取専用属性を切り替えるだけで、
 * ディレクトリの読取専用属性は中にファイルを作ることを防がない (#36)。
 * これに依存する検査は POSIX でだけ実行し、期待する skip は
 * scripts/expected-skips.json に載せる。
 */
const onWindows = process.platform === "win32";

/**
 * 読取専用のファイルへの保存が返すコード。
 * Windows では読取専用属性が EPERM として返ることがある。
 */
const READ_ONLY_CODES = onWindows ? ["EPERM", "EACCES"] : ["EACCES"];

describe("writeFileAtomic: 既存ファイルの権限", () => {
  // Windows: mode が無い。
  it.skipIf(onWindows)("既存の mode を引き継ぐ (0600 のまま)", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    chmodSync(file, 0o600);
    await writeFileAtomic(file, "NEW");
    expect(modeOf(file)).toBe(0o600);
  });

  // Windows: mode が無い。
  it.skipIf(onWindows)("umask より広い mode も正確に引き継ぐ", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    chmodSync(file, 0o664);
    await writeFileAtomic(file, "NEW");
    expect(modeOf(file)).toBe(0o664);
  });

  it("読取専用のファイルは従来どおり失敗させ、何も変えない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    writeFileSync(`${file}.bak`, "PREV");
    chmodSync(file, 0o444);

    const err = await writeFileAtomic(file, "NEW", {
      backupPath: `${file}.bak`,
    }).then(
      () => undefined,
      (e: unknown) => e as NodeJS.ErrnoException,
    );
    expect(READ_ONLY_CODES).toContain(err?.code);

    // rename はディレクトリの権限しか見ないので、確認しないと置き換わってしまう。
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(readFileSync(`${file}.bak`, "utf-8")).toBe("PREV");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("既存ファイルが書き込めるなら、保存後も書き込めるまま (読取専用にならない)", async () => {
    // mode の引き継ぎ (上の2件) が Windows で守っている性質に相当する。全 OS で実行する。
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    await writeFileAtomic(file, "NEW");
    expect(() => accessSync(file, constants.W_OK)).not.toThrow();
    expect(readFileSync(file, "utf-8")).toBe("NEW");
  });

  // Windows: ディレクトリの読取専用属性はファイルの作成を防がない。
  it.skipIf(onWindows)("ディレクトリが書込み不可なら失敗し、対象は無傷", async () => {
    const dir = path.join(tmpDir(), "ro");
    mkdirSync(dir);
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    chmodSync(dir, 0o555);

    await expect(writeFileAtomic(file, "NEW")).rejects.toMatchObject({
      code: "EACCES",
    });
    chmodSync(dir, 0o755);
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("対象がディレクトリなら失敗し、中身を壊さない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    mkdirSync(file);
    writeFileSync(path.join(file, "inside"), "KEEP");

    await expect(
      writeFileAtomic(file, "NEW", { backupPath: `${file}.bak` }),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(readFileSync(path.join(file, "inside"), "utf-8")).toBe("KEEP");
    expect(tempsIn(dir)).toEqual([]);
  });
});

describe("writeFileAtomic: 途中で失敗しても対象は旧内容のまま", () => {
  it("一時ファイルへの書込みに失敗 (ENOSPC)", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    const fs: AtomicWriteFs = {
      ...realFs,
      open: (async (p, flags, mode) => {
        const handle = await nodeFs.open(p, flags, mode);
        if (flags !== "wx") return handle;
        return Object.assign(Object.create(handle), {
          writeFile: async () => {
            throw errno("ENOSPC");
          },
          close: () => handle.close(),
        });
      }) as AtomicWriteFs["open"],
    };

    await expect(writeFileAtomic(file, "NEW", {}, fs)).rejects.toMatchObject({
      code: "ENOSPC",
    });
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("fsync に失敗", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    const fs: AtomicWriteFs = {
      ...realFs,
      open: (async (p, flags, mode) => {
        const handle = await nodeFs.open(p, flags, mode);
        if (flags !== "wx") return handle;
        return Object.assign(Object.create(handle), {
          writeFile: (d: string, e: BufferEncoding) => handle.writeFile(d, e),
          chmod: (m: number) => handle.chmod(m),
          sync: async () => {
            throw errno("EIO");
          },
          close: () => handle.close(),
        });
      }) as AtomicWriteFs["open"],
    };

    await expect(writeFileAtomic(file, "NEW", {}, fs)).rejects.toMatchObject({
      code: "EIO",
    });
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("バックアップのコピーに失敗したら保存を中止する", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    const fs: AtomicWriteFs = {
      ...realFs,
      copyFile: (async () => {
        throw errno("ENOSPC");
      }) as AtomicWriteFs["copyFile"],
    };

    await expect(
      writeFileAtomic(file, "NEW", { backupPath: `${file}.bak` }, fs),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    // バックアップなしには書かない。
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("rename に失敗 (POSIX)", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    const fs: AtomicWriteFs = {
      ...realFs,
      rename: (async () => {
        throw errno("EXDEV");
      }) as AtomicWriteFs["rename"],
    };

    await expect(
      writeFileAtomic(file, "NEW", { platform: "darwin" }, fs),
    ).rejects.toMatchObject({ code: "EXDEV" });
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(tempsIn(dir)).toEqual([]);
  });
});

describe("writeFileAtomic: Windows の rename 再試行", () => {
  function flakyRename(failures: number, code = "EPERM") {
    let calls = 0;
    const rename = (async (from: string, to: string) => {
      calls += 1;
      if (calls <= failures) throw errno(code);
      await nodeFs.rename(from, to);
    }) as AtomicWriteFs["rename"];
    return { rename, calls: () => calls };
  }

  it("一時的な EPERM は再試行で成功する", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    const flaky = flakyRename(2);
    const { waits, sleep } = recordingSleep();

    await writeFileAtomic(
      file,
      "NEW",
      { platform: "win32", sleep },
      { ...realFs, rename: flaky.rename },
    );

    expect(readFileSync(file, "utf-8")).toBe("NEW");
    expect(flaky.calls()).toBe(3);
    expect(waits).toEqual([10, 20]);
    expect(tempsIn(dir)).toEqual([]);
  });

  it.each(["EBUSY", "EACCES"])("%s も再試行の対象", async (code) => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    const flaky = flakyRename(1, code);
    await writeFileAtomic(
      file,
      "NEW",
      { platform: "win32", sleep: recordingSleep().sleep },
      { ...realFs, rename: flaky.rename },
    );
    expect(readFileSync(file, "utf-8")).toBe("NEW");
  });

  it("失敗が続けば規定回数で諦め、対象は無傷", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    writeFileSync(file, "OLD");
    const flaky = flakyRename(Number.POSITIVE_INFINITY);

    await expect(
      writeFileAtomic(
        file,
        "NEW",
        { platform: "win32", sleep: recordingSleep().sleep },
        { ...realFs, rename: flaky.rename },
      ),
    ).rejects.toMatchObject({ code: "EPERM" });
    expect(flaky.calls()).toBe(5);
    expect(readFileSync(file, "utf-8")).toBe("OLD");
    expect(tempsIn(dir)).toEqual([]);
  });

  it("POSIX では EPERM を再試行しない", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    const flaky = flakyRename(1);
    const { waits, sleep } = recordingSleep();

    await expect(
      writeFileAtomic(
        file,
        "NEW",
        { platform: "linux", sleep },
        { ...realFs, rename: flaky.rename },
      ),
    ).rejects.toMatchObject({ code: "EPERM" });
    expect(flaky.calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("一時的でない失敗は Windows でも再試行しない", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    const flaky = flakyRename(1, "ENOSPC");
    await expect(
      writeFileAtomic(
        file,
        "NEW",
        { platform: "win32", sleep: recordingSleep().sleep },
        { ...realFs, rename: flaky.rename },
      ),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(flaky.calls()).toBe(1);
  });
});

describe("writeFileAtomic: 永続化の補強と後始末", () => {
  it("ディレクトリの fsync に失敗しても保存は成功扱い", async () => {
    const file = path.join(tmpDir(), "settings.json");
    writeFileSync(file, "OLD");
    const dir = path.dirname(file);
    const fs: AtomicWriteFs = {
      ...realFs,
      open: (async (p, flags, mode) => {
        if (p === dir) throw errno("EPERM");
        return nodeFs.open(p, flags, mode);
      }) as AtomicWriteFs["open"],
    };
    await writeFileAtomic(file, "NEW", { platform: "darwin" }, fs);
    expect(readFileSync(file, "utf-8")).toBe("NEW");
  });

  it("Windows ではディレクトリを fsync しない", async () => {
    const file = path.join(tmpDir(), "settings.json");
    const dir = path.dirname(file);
    let dirOpened = false;
    const fs: AtomicWriteFs = {
      ...realFs,
      open: (async (p, flags, mode) => {
        if (p === dir) dirOpened = true;
        return nodeFs.open(p, flags, mode);
      }) as AtomicWriteFs["open"],
    };
    await writeFileAtomic(file, "NEW", { platform: "win32" }, fs);
    expect(dirOpened).toBe(false);
  });

  it("クラッシュで残った古い一時ファイルを掃除する", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    const stale = path.join(dir, "settings.json.123-0123456789abcdef.tmp");
    writeFileSync(stale, "LEFTOVER");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(stale, old, old);

    await writeFileAtomic(file, "NEW");

    expect(tempsIn(dir)).toEqual([]);
  });

  it("新しい一時ファイル (他の保存が使用中かもしれない) は消さない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    const fresh = path.join(dir, "settings.json.456-fedcba9876543210.tmp");
    writeFileSync(fresh, "IN-FLIGHT");

    await writeFileAtomic(file, "NEW");

    expect(tempsIn(dir)).toEqual(["settings.json.456-fedcba9876543210.tmp"]);
  });

  it("名前の形が違うファイルは古くても消さない", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "settings.json");
    const unrelated = path.join(dir, "notes.tmp");
    writeFileSync(unrelated, "KEEP");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(unrelated, old, old);

    await writeFileAtomic(file, "NEW");

    expect(readFileSync(unrelated, "utf-8")).toBe("KEEP");
  });
});
