import type { AikaApi } from "@shared/ipc/contract";

/**
 * renderer 側の Window 型拡張。
 * contextBridge により window.aika に AikaApi が公開される。
 */
declare global {
  interface Window {
    readonly aika: AikaApi;
  }
}

export {};
