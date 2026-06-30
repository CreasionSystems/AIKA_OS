import type { AikaApi } from "@shared/ipc/contract";

/**
 * renderer 側で型安全に公開 API を取得するアクセサ。
 * window.aika の型は window.d.ts の Window 拡張で保証される。
 */
export function getAikaApi(): AikaApi {
  return window.aika;
}
