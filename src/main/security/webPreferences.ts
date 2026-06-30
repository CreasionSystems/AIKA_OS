/**
 * Electron の権限境界を「契約」として固定するモジュール。
 *
 * renderer を信用せず、main / preload / renderer の境界を明確にする。
 *
 * ハード契約 (assertSecureWebPreferences で強制):
 *  - contextIsolation === true
 *  - nodeIntegration === false
 *  - preload は絶対パス必須
 *
 * 方針レベル (安全デフォルト・上書き可, 強制はしない):
 *  - sandbox === true
 */

/** BrowserWindow.webPreferences のうち本プロジェクトで固定/管理する最小サブセット。 */
export interface SecureWebPreferences {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  /** preload スクリプトの絶対パス。未設定の場合は省略。 */
  preload?: string;
}

export interface CreateSecureWebPreferencesOptions {
  /** preload スクリプトの絶対パス。 */
  preloadPath?: string;
  /** 安全デフォルト (true) を上書きしたい場合のみ指定。 */
  sandbox?: boolean;
}

/** 文字列が POSIX 絶対パスか。 */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/");
}

/**
 * 安全な webPreferences を生成する。
 * contextIsolation/nodeIntegration はハード契約として固定し、外部から変更させない。
 * sandbox は安全デフォルト true、明示指定で上書き可能 (方針レベル)。
 */
export function createSecureWebPreferences(
  options: CreateSecureWebPreferencesOptions = {},
): SecureWebPreferences {
  const { preloadPath, sandbox = true } = options;

  const prefs: SecureWebPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox,
  };

  if (preloadPath !== undefined) {
    if (!isAbsolutePath(preloadPath)) {
      throw new Error(
        `preload は絶対パスである必要があります: received "${preloadPath}"`,
      );
    }
    prefs.preload = preloadPath;
  }

  return prefs;
}

/**
 * webPreferences がハード契約を満たすか検証する。違反時は理由付きで throw。
 * sandbox は方針レベルのため検証対象外 (false でも throw しない)。
 */
export function assertSecureWebPreferences(
  prefs: SecureWebPreferences,
): void {
  if (prefs.contextIsolation !== true) {
    throw new Error(
      "安全構成違反: contextIsolation は true である必要があります",
    );
  }
  if (prefs.nodeIntegration !== false) {
    throw new Error(
      "安全構成違反: nodeIntegration は false である必要があります",
    );
  }
  if (prefs.preload === undefined || !isAbsolutePath(prefs.preload)) {
    throw new Error(
      `安全構成違反: preload は絶対パスである必要があります: received "${String(prefs.preload)}"`,
    );
  }
}
