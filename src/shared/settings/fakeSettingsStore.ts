import type {
  AppSettings,
  SettingsReadFailure,
  SettingsReadResult,
  SettingsStore,
} from "./settings";

/**
 * メモリ上の SettingsStore 実装 (テスト / 既定フォールバック用)。
 * 正式な SettingsStore 契約を満たす Fake。
 *
 * failure を与えると読み取り不能な永続層として振る舞う。
 */
export class FakeSettingsStore implements SettingsStore {
  private data: Record<string, unknown> | null;

  constructor(
    initial: Record<string, unknown> | null = null,
    private readonly failure?: SettingsReadFailure,
  ) {
    this.data = initial;
  }

  read(): Promise<SettingsReadResult> {
    if (this.failure !== undefined) {
      return Promise.resolve({ status: "unreadable", failure: this.failure });
    }
    return Promise.resolve(
      this.data === null
        ? { status: "missing" }
        : { status: "loaded", raw: this.data },
    );
  }

  write(settings: AppSettings): Promise<void> {
    this.data = { ...settings };
    return Promise.resolve();
  }
}
