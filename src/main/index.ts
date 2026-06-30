import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createSecureWebPreferences } from "./security/webPreferences";
import { registerInferenceIpc } from "./ipc/registerInferenceIpc";
import { InferenceService } from "./inference/inferenceService";
import { DummyInferenceAdapter } from "./inference/dummyInferenceAdapter";
import { JobQueue } from "./jobs/jobQueue";

/**
 * Electron Main エントリ (最小結線)。
 *
 * - 安全構成は createSecureWebPreferences() に集約。
 * - IPC は registerInferenceIpc() で InferenceService に委譲。
 * - 推論基盤は当面 DummyInferenceAdapter (Fake)。
 */

function buildInferenceService(): InferenceService {
  return new InferenceService(new DummyInferenceAdapter(), new JobQueue());
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

app.whenReady().then(() => {
  registerInferenceIpc(ipcMain, buildInferenceService());
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
