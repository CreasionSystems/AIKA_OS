import type { AppSettings, SettingsStore } from "./settings";

/**
 * メモリ上の SettingsStore 実装 (テスト / 既定フォールバック用)。
 * 正式な SettingsStore 契約を満たす Fake。
 */
export class FakeSettingsStore implements SettingsStore {
  private data: Record<string, unknown> | null;

  constructor(initial: Record<string, unknown> | null = null) {
    this.data = initial;
  }

  read(): Promise<Record<string, unknown> | null> {
    return Promise.resolve(this.data);
  }

  write(settings: AppSettings): Promise<void> {
    this.data = { ...settings };
    return Promise.resolve();
  }
}
