import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createSecureWebPreferences } from "./security/webPreferences";
import { registerInferenceIpc } from "./ipc/registerInferenceIpc";
import { registerSettingsIpc } from "./ipc/registerSettingsIpc";
import { registerUpdateIpc } from "./ipc/registerUpdateIpc";
import { registerCodingIpc } from "./ipc/registerCodingIpc";
import { registerJobsIpc } from "./ipc/registerJobsIpc";
import { UpdateManager, FakeUpdateChecker } from "./update/updateManager";
import { InferenceService } from "./inference/inferenceService";
import { DummyInferenceAdapter } from "./inference/dummyInferenceAdapter";
import { JobQueue, type Job } from "./jobs/jobQueue";
import { CodingWorkflow } from "./coding/codingWorkflow";
import { SettingsService } from "@shared/settings/settings";
import { FileSettingsStore } from "./settings/fileSettingsStore";
import { JobHistory } from "@shared/jobs/jobHistory";
import type {
  ImageJobResult,
  VideoJobResult,
} from "@shared/inference/port";

/**
 * Electron Main エントリ (最小結線)。
 *
 * - 安全構成は createSecureWebPreferences() に集約。
 * - IPC は registerInferenceIpc() で InferenceService に委譲。
 * - 推論基盤は当面 DummyInferenceAdapter (Fake)。
 */

function buildSettingsService(): SettingsService {
  const file = path.join(app.getPath("userData"), "settings.json");
  return new SettingsService(new FileSettingsStore(file));
}

/** 完了したメディアジョブを履歴へ記録する。 */
function recordMediaJob(history: JobHistory, job: Job): void {
  if (job.state !== "succeeded" && job.state !== "failed") return;
  const result = job.result as ImageJobResult | VideoJobResult | undefined;
  const kind =
    result && "kind" in result ? (result as VideoJobResult).kind : undefined;
  history.record({
    jobId: job.id,
    state: job.state,
    ...(kind !== undefined ? { kind } : {}),
    ...(result?.artifacts ? { artifacts: result.artifacts } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
  });
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: createSecureWebPreferences({ preloadPath }),
  });
  void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  window.once("ready-to-show", () => window.show());
  return window;
}

app.whenReady().then(async () => {
  const settingsService = buildSettingsService();
  const settings = await settingsService.load();

  // ジョブ履歴 (メモリ常駐, jobHistoryLimit に従う FIFO)。
  const history = new JobHistory(settings.jobHistoryLimit);
  const queue = new JobQueue({
    onSettle: (job) => recordMediaJob(history, job),
  });

  // InferenceService は推論 IPC とコーディングワークフローで共有する。
  const inference = new InferenceService(new DummyInferenceAdapter(), queue);
  registerInferenceIpc(ipcMain, inference);
  registerSettingsIpc(ipcMain, settingsService);
  // 当面は Fake チェッカ (最新を返す)。実チェッカは後続で差し替える。
  registerUpdateIpc(ipcMain, new UpdateManager(new FakeUpdateChecker(null)));
  registerCodingIpc(ipcMain, new CodingWorkflow(inference));
  registerJobsIpc(ipcMain, history);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // macOS 以外はウィンドウが全て閉じたら終了する。
  if (process.platform !== "darwin") {
    app.quit();
  }
});
