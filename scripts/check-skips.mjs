import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * skip されたテストが、OS ごとの期待リスト (scripts/expected-skips.json) と
 * 完全に一致することを確かめる (#36)。
 *
 * OS によって成り立たない検査は条件付きで skip している。skip は黙って増えたり
 * 減ったりしやすいため、次のどちらも失敗にする。
 * - 期待リストに無いのに skip されたテスト
 * - 期待リストにあるのに実行されたテスト
 *
 * 使い方:
 *   node scripts/check-skips.mjs --vitest <vitest の JSON> --playwright <Playwright の JSON>
 *   (--platform <linux|darwin|win32> で OS を上書きできる。照合を確かめるとき用)
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`引数が不正です: ${argv.join(" ")}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

const toPosix = (p) => p.split(path.sep).join("/");

function readReport(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    // 前のステップが途中で落ちて結果が無いときに、黙って成功にしない。
    throw new Error(`${label} の結果を読めません (${file}): ${err.message}`);
  }
}

/** Vitest の JSON から、実行されなかったテストを集める。 */
function vitestSkips(report) {
  const skipped = [];
  let total = 0;
  for (const file of report.testResults ?? []) {
    const rel = toPosix(path.relative(root, path.resolve(file.name)));
    for (const t of file.assertionResults ?? []) {
      total += 1;
      if (t.status === "passed" || t.status === "failed") continue;
      skipped.push([rel, ...t.ancestorTitles, t.title].join(" > "));
    }
  }
  return { skipped, total };
}

/** Playwright の JSON から、実行されなかったテストを集める。 */
function playwrightSkips(report) {
  const skipped = [];
  let total = 0;
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        total += 1;
        if (t.status !== "skipped") continue;
        const file = `e2e/${toPosix(spec.file)}`;
        skipped.push([file, ...titles, spec.title].join(" > "));
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  // 最上位の suite はファイル単位で、title はファイル名。
  for (const fileSuite of report.suites ?? []) walk(fileSuite, []);
  return { skipped, total };
}

function compare(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const unexpected = actual.filter((k) => !expectedSet.has(k));
  const ran = expected.filter((k) => !actualSet.has(k));
  const problems = [];
  if (unexpected.length > 0) {
    problems.push(
      `${label}: 期待リストに無い skip が ${unexpected.length} 件あります:\n` +
        unexpected.map((k) => `  - ${k}`).join("\n"),
    );
  }
  if (ran.length > 0) {
    problems.push(
      `${label}: 期待リストにあるのに実行されたテストが ${ran.length} 件あります:\n` +
        ran.map((k) => `  - ${k}`).join("\n"),
    );
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = args.platform ?? process.platform;
  const expected = JSON.parse(
    readFileSync(path.join(root, "scripts", "expected-skips.json"), "utf-8"),
  );

  const problems = [];
  const summary = [];
  const suites = [
    ["unit", args.vitest, "Vitest", vitestSkips],
    ["e2e", args.playwright, "Playwright", playwrightSkips],
  ];
  for (const [kind, file, label, collect] of suites) {
    if (file === undefined) {
      throw new Error(`--${label === "Vitest" ? "vitest" : "playwright"} を指定してください`);
    }
    const list = expected[kind]?.[platform];
    if (!Array.isArray(list)) {
      throw new Error(`expected-skips.json に ${kind}.${platform} がありません`);
    }
    const { skipped, total } = collect(readReport(file, label));
    if (total === 0) {
      throw new Error(`${label} の結果にテストが1件もありません (${file})`);
    }
    summary.push(`${kind}: ${total} 件中 ${skipped.length} 件 skip (期待 ${list.length} 件)`);
    problems.push(...compare(kind, skipped, list));
  }

  console.log(`skip の照合 (${platform})`);
  for (const line of summary) console.log(`  ${line}`);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("  期待リストと一致しました。");
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
