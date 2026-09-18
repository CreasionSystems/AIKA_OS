import { describe, it, expect, afterEach } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSettingsStore } from "./fileSettingsStore";
import { DEFAULT_SETTINGS } from "@shared/settings/settings";

/**
 * 実保存 (JSON ファイル) の往復テスト。
 * パスは注入。main では app.getPath("userData") 配下を渡す前提。
 */

const dirs: string[] = [];
function tmpFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aika-settings-"));
  dirs.push(dir);
  return path.join(dir, "settings.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("FileSettingsStore", () => {
  it("未作成ファイルの read は missing (初回起動)", async () => {
    const store = new FileSettingsStore(tmpFile());
    expect(await store.read()).toEqual({ status: "missing" });
  });

  it("write した内容を read で取り出せる", async () => {
    const file = tmpFile();
    const store = new FileSettingsStore(file);
    await store.write({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(await store.read()).toMatchObject({
      status: "loaded",
      raw: { theme: "dark" },
    });
  });
});

/**
 * 読み取り失敗の分類 (#31)。
 *
 * 「読めない」を例外で伝えると、main の起動処理で未処理の reject になり
 * ウィンドウが開かなくなる。値として分類して返す。
 */
describe("FileSettingsStore: 読み取り失敗の分類", () => {
  it("権限がなければ permission", async () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS), "utf-8");
    chmodSync(file, 0o000);
    const res = await new FileSettingsStore(file).read();
    chmodSync(file, 0o644); // afterEach で削除できるよう戻す
    expect(res).toEqual({ status: "unreadable", failure: "permission" });
  });

  it("ディレクトリなら not-a-file", async () => {
    const file = tmpFile();
    mkdirSync(file);
    expect(await new FileSettingsStore(file).read()).toEqual({
      status: "unreadable",
      failure: "not-a-file",
    });
  });

  it("JSON 構文エラーは malformed", async () => {
    const file = tmpFile();
    writeFileSync(file, '{ "theme": "dark", ', "utf-8");
    expect(await new FileSettingsStore(file).read()).toEqual({
      status: "unreadable",
      failure: "malformed",
    });
  });

  it("空ファイルは malformed", async () => {
    const file = tmpFile();
    writeFileSync(file, "", "utf-8");
    expect(await new FileSettingsStore(file).read()).toEqual({
      status: "unreadable",
      failure: "malformed",
    });
  });

  // 以前は配列が typeof "object" を通り、全項目が既定値へ落ちたうえで
  // 次回保存時に元ファイルを上書きしていた (#32)。
  it("配列は malformed (設定オブジェクトではない)", async () => {
    const file = tmpFile();
    writeFileSync(file, "[1,2,3]", "utf-8");
    expect(await new FileSettingsStore(file).read()).toEqual({
      status: "unreadable",
      failure: "malformed",
    });
  });

  it.each([
    ['"just a string"', "文字列"],
    ["42", "数値"],
    ["null", "null"],
  ])("%s (%s) は malformed", async (body) => {
    const file = tmpFile();
    writeFileSync(file, body, "utf-8");
    expect(await new FileSettingsStore(file).read()).toEqual({
      status: "unreadable",
      failure: "malformed",
    });
  });
});

/**
 * 書込みの保全 (#33)。
 * 置き換えは atomic に行い、直前の内容を 1世代だけ残す。
 */
describe("FileSettingsStore: 書込みの保全", () => {
  it("上書き前の内容を settings.json.bak に残す", async () => {
    const file = tmpFile();
    const store = new FileSettingsStore(file);
    await store.write({ ...DEFAULT_SETTINGS, theme: "dark" });
    await store.write({ ...DEFAULT_SETTINGS, theme: "light" });

    expect(JSON.parse(readFileSync(`${file}.bak`, "utf-8")).theme).toBe("dark");
    expect(await store.read()).toMatchObject({
      status: "loaded",
      raw: { theme: "light" },
    });
  });

  it("初回の書込みではバックアップを作らず、一時ファイルも残さない", async () => {
    const file = tmpFile();
    await new FileSettingsStore(file).write(DEFAULT_SETTINGS);
    expect(readdirSync(path.dirname(file))).toEqual(["settings.json"]);
  });

  it("read は .bak を読まない (本体が無ければ missing)", async () => {
    const file = tmpFile();
    writeFileSync(`${file}.bak`, JSON.stringify({ theme: "dark" }), "utf-8");
    expect(await new FileSettingsStore(file).read()).toEqual({
      status: "missing",
    });
  });

  it("読取専用の設定ファイルには従来どおり書けない", async () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS), "utf-8");
    chmodSync(file, 0o444);
    await expect(
      new FileSettingsStore(file).write({ ...DEFAULT_SETTINGS, theme: "dark" }),
    ).rejects.toMatchObject({ code: "EACCES" });
    chmodSync(file, 0o644);
    expect(JSON.parse(readFileSync(file, "utf-8")).theme).toBe(
      DEFAULT_SETTINGS.theme,
    );
  });

  it("既存ファイルの権限を変えない", async () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS), "utf-8");
    chmodSync(file, 0o600);
    await new FileSettingsStore(file).write({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
