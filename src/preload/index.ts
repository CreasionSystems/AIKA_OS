import { contextBridge, ipcRenderer } from "electron";
import { exposeAikaApi } from "./bridge";

/**
 * Electron Preload エントリ (最小結線)。
 *
 * contextBridge へ window.aika を公開し、汎用 ipcRenderer は露出しない。
 * 実際の invoke のみを薄く注入する。
 */
exposeAikaApi(contextBridge, (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args),
);
