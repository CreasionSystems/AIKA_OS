import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";

/**
 * Electron バイナリを provision する (Linux x64)。
 *
 * 既定の postinstall ダウンロードがプロキシを使わない環境向け。
 * curl は HTTPS_PROXY と CA バンドルを尊重するため、curl 経由で取得する。
 *
 * 使い方:
 *   ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install
 *   node scripts/fetch-electron.mjs
 */
if (process.platform !== "linux" || process.arch !== "x64") {
  console.log(
    `skip: this helper targets linux/x64 (got ${process.platform}/${process.arch}). ` +
      "Use the standard electron postinstall instead.",
  );
  process.exit(0);
}

const version = JSON.parse(
  readFileSync("node_modules/electron/package.json", "utf-8"),
).version;

const zipName = `electron-v${version}-linux-x64.zip`;
const url = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`;
const tmpZip = `node_modules/.cache/${zipName}`;
const distDir = "node_modules/electron/dist";

mkdirSync("node_modules/.cache", { recursive: true });

console.log(`downloading ${url}`);
const curlArgs = ["-sSL", "-o", tmpZip, url];
const caBundle = process.env.NODE_EXTRA_CA_CERTS ?? "/root/.ccr/ca-bundle.crt";
try {
  execFileSync("curl", ["--cacert", caBundle, ...curlArgs], {
    stdio: "inherit",
  });
} catch {
  // CA フラグが使えない環境ではシステム CA にフォールバック。
  execFileSync("curl", curlArgs, { stdio: "inherit" });
}

console.log(`extracting into ${distDir}`);
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
execFileSync("unzip", ["-q", tmpZip, "-d", distDir], { stdio: "inherit" });

// electron wrapper は path.txt から実行ファイル名を読む (末尾改行を入れない)。
writeFileSync("node_modules/electron/path.txt", "electron");
execFileSync("chmod", ["+x", `${distDir}/electron`]);

console.log(`electron ${version} provisioned at ${distDir}/electron`);
