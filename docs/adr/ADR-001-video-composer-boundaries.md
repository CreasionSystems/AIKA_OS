# ADR-001: 動画生成 UI における会話と構造化パラメータの責務境界

- 状態: 確定 (Accepted)
- 日付: 2026-09-16
- 対象 main SHA: 0221cf26515b02146ea2fa406e3ae6e34b917bd4
- 関連: #14 (Step 40 対話型 UI), #18 (Step 41-1), #19 (Step 41-2), 基準設計書「動画生成画面」「Workflow Router」

## 背景

基準設計書では、動画生成画面の入力項目に「プロンプト / 参照画像・元動画・音声 / 長さ / fps / 解像度 / 品質プリセット / モーション強度」があり、**Workflow Router がモード別テンプレートを選定し、必要パラメータを JSON テンプレートへ注入する**と定義されている。VRAM 不足時に軽量設定を提案する例外設計もある。

一方、Step 40 で導入した対話型 UI (VideoPromptComposer) は自由文から prompt 文字列を1本作るだけで、**構造化パラメータを一切生んでいない**。現在の型契約は以下にとどまる。

```ts
interface VideoJobRequest { kind: VideoKind; prompt?: string; sourceImage?: string; }
```

Step 41-3 (チャット形式の会話履歴) は会話状態モデルと PromptRefinementPort の I/O に触れるため、この境界を決めずに着手すると、後から会話履歴モデル・port・Router 境界が壊れる。

## 選択肢

| 案 | 内容 | 評価 |
|---|---|---|
| A 自然文中心 | 会話 UI は prompt 文字列のみ扱い、パラメータは別 UI か後段 | **不採用**。Router が必要とする値を後段で再解釈することになり、入力の責務が分散する |
| B ハイブリッド | 自然文 + 構造化フィールド。LLM は候補を提案し、確定値は正規化して作る | **採用** |
| C 構造化中心 | 最初から全パラメータを構造化入力。会話は補助のみ | **不採用**。対話 UX の価値を下げ、Step 40 以降と不整合 |

## 決定

### D1. UI 方針はハイブリッド (案B)

データの流れを次の4層に分離する。

```
自然文・会話 → PromptRefinementPort → draftText + suggestedParams
  → ユーザー確認・編集 → composer state → 正規化・検証
  → NormalizedVideoJobRequest → IPC → Workflow Router → テンプレート選択 + JSON 注入
```

**refinement が返したパラメータをそのまま実行値にしない。** ユーザー確認を経た draft を正規化して確定値を作る。

### D2. 責務境界

| 層 | 担当する | 担当しない |
|---|---|---|
| VideoPromptComposer | 会話表示、自然文入力、follow-up 表示、構造化パラメータの編集、候補の適用、送信前の状態表示 | Workflow JSON の構築、テンプレート選択、VRAM 判定、バックエンド固有ノードの知識、送信可能性の最終保証 |
| PromptRefinementPort | follow-up 質問、改善ドラフト、パラメータ候補と根拠、不足入力の指摘 | 候補値の最終確定、実行設定の確定、JSON 生成、ジョブ送信 |
| Normalizer / IPC | 入力の正規化と検証。Renderer は早期フィードバック、Main は最終境界として**再検証** | テンプレート知識 |
| Workflow Router | kind に応じたテンプレート選択、JSON 注入、実行環境・モデル確認、VRAM 不足時の軽量設定**提案**、診断生成 | ユーザー入力を黙って書き換えること |

### D3. 型契約

```ts
// 資産入力 (参照画像・元動画・音声へ拡張可能にする)
type MediaAssetKind = "image" | "video" | "audio";
interface LocalMediaAsset { kind: MediaAssetKind; path: string; }

// 動画パラメータ
type Resolution = "480p" | "720p" | "1080p";
type QualityPreset = "draft" | "standard" | "high";
interface VideoGenerationParams {
  durationSec: number; fps: number; resolution: Resolution;
  qualityPreset: QualityPreset; motionStrength: number;
}

// 編集中 (不足を表現できる)
interface VideoDraft {
  prompt: string;
  params: Partial<VideoGenerationParams>;
  assets: readonly LocalMediaAsset[];
  completeness: "incomplete" | "complete" | "invalid";
}

// 送信可能な確定値
interface NormalizedVideoJobRequest {
  kind: VideoKind; prompt: string;
  assets: readonly LocalMediaAsset[]; params: VideoGenerationParams;
}
```

`VideoJobRequest` は当面この共通構造へ移行する。**モード別 discriminated union (T2V / I2V / …) は 41-3 では確定しない** — 各モードの資産要件が未確定のため、Router 契約を決める PR で固定する。

**資産は tuple で個数を固定せず、`readonly LocalMediaAsset[]` + 要件検証にする。** 将来のテンプレートは複数参照画像・first/last frame・複数音声などを扱うため (Wan 3.0 の ComfyUI workflow は参照画像最大10枚・参照動画5本・音声5本)、tuple では表現できなくなる。

### D3b. パラメータの範囲は共通定数に埋め込まず、capability descriptor から引く

`durationSec` / `fps` の許容値はモデルごとに異なり、共通集合を作れない。したがって**型にも共通定数にも範囲を埋め込まない**。検証は「要求値 + 能力記述」を受け取る純粋関数が行う。

```ts
type PromptRequirement = "required" | "optional" | "forbidden";
type AssetRequirement = { kind: LocalMediaAsset["kind"]; min: number; max?: number };
type FrameCountRule =
  | { kind: "exact"; frameCount: number }
  | { kind: "range"; min: number; max: number; step?: number }
  | { kind: "modulo"; modulus: number; remainder: number; min?: number; max?: number };

type VideoCapabilityDescriptor = {
  allowedFps: readonly number[];
  durationSec: { min: number; max: number; allowed?: readonly number[] };
  frameCount: FrameCountRule;
  supportedResolutions: readonly Resolution[];
  supportedQualityPresets: readonly QualityPreset[];
  resolutionQualityPairs?: readonly { resolution: Resolution; qualityPreset: QualityPreset }[];
  promptRequirement: PromptRequirement;
  assetRequirements: readonly AssetRequirement[];
};

function validateVideoParams(
  params: VideoGenerationParams,
  capability: VideoCapabilityDescriptor,
): ValidationResult;
```

- `fps` は固定 union にせず `number` (正整数)。許容値は `allowedFps` で検証。根拠: Wan 2.1 は 16fps 中心、LTX-Video は 24/30fps (新しい系では 24/25/48/50)、SVD は 6fps 前後で学習されており、共通集合を作れない
- `durationSec` の既定値は 5 (Wan 2.1 の代表構成 81 frames / 16fps ≒ 5秒)。**共通の上限は設けない** (LTX 系は 6〜20秒の選択肢を持つ)。共通で検証するのは「有限の正数」までとし、min/max/allowed は descriptor
- `motionStrength` は 0.0–1.0 の正規化値、既定 0.5。これはモデルの物理パラメータではなく AIKA_OS の UI 意味論であり、SVD の `motion_bucket_id` (1–255) や AnimateDiff の motion scale とは意味が異なるため、**直接同一視しない**。写像は Router / capability 側

### D3c. フレーム数制約 (durationSec × fps は独立ではない)

UI の契約は秒と fps で独立させるが、**実行可能性は独立ではない**。Wan 2.1 はフレーム数が `4n+1` (代表 81)、LTX-Video は `8n+1` を要求する。

したがって `5秒 × 16fps = 80 frames` は **Wan 2.1 の有効フレーム条件を満たさない**。共有の純粋関数が `requestedFrameCount` を導出し、`FrameCountRule` で検証する。**80 を 81 に黙って補正しない** (D8 と一貫)。検証エラーにするか、UI が有効な duration 選択肢を提示する。

`requestedFrameCount` は検証上の導出値であり、ユーザー入力として公開しない。

### D3d. qualityPreset と resolution は直交させる

概念上は分離する (`resolution` = 出力サイズの意図、`qualityPreset` = 品質・計算量・workflow variant の意図)。`480p + high` や `720p + draft` を型で禁じない。Wan 2.1 は 480p / 720p で別モデル構成を持ち、「品質が高いほど解像度も高い」とは限らないため。実行可能な組み合わせは descriptor の `resolutionQualityPairs` で検証する。**`qualityPreset` を `resolution` の別名にしない。**

### D4. Refinement の拡張

port は構造化候補を返せるようにする（文字列専用に保つ、という前回の助言を**上書き**）。

```ts
interface RefineInput {
  instruction: string;
  answers?: Readonly<Record<string, string>>;
  currentDraft?: string;
  currentParams?: Partial<VideoGenerationParams>;
  assets?: readonly LocalMediaAsset[];
}
interface SuggestedParam<K extends keyof VideoGenerationParams = keyof VideoGenerationParams> {
  key: K; value: VideoGenerationParams[K];
  confidence?: "low" | "medium" | "high"; reason?: string;
}
// 質問はローカライズ済み文字列ではなく意味 ID を返し、Renderer が i18n キーへマップする。
interface RefinementQuestion { id: string; fields?: readonly string[]; }
type RefinementOutcome =
  | { kind: "needs-follow-up"; questions: readonly RefinementQuestion[]; suggestions?: readonly SuggestedParam[] }
  | { kind: "draft-produced"; draftPrompt: string; summary: string; suggestedParams?: readonly SuggestedParam[] };
```

`follow-up` / `ready` という語を複数の状態機械で使わないため、refinement の結果は `needs-follow-up` / `draft-produced` に改名する。

**port に `turns` を渡さない**（前回の助言を維持）。渡すと推論入力モデルが UI 履歴モデルに結合する。

### D5. 状態モデルの分離

```ts
interface VideoComposerState {
  turns: readonly ConversationTurn[];      // 表示用。処理状態を持たない
  draft: VideoDraft;
  operation: OperationState;               // 非表示の処理状態
  followUpQuestions: readonly RefinementQuestion[];
  validation: ValidationResult;
  copyState: "idle" | "copied" | "error";
}
type OperationState =
  | { status: "idle" }
  | { status: "refining" | "validating" | "ready" | "sending"; requestId: string }
  | { status: "success"; requestId: string; jobId: string }
  | { status: "error"; requestId: string; errorCode: VideoOperationErrorCode };
```

- `follow-up` は OperationState に置かない（処理状態ではなく refinement の結果であり、会話と draft の状態のため）
- `turns` に requestId / copyState / sourceInvalid / Abort 状態 / 内部エラーオブジェクト / 正規化済みパラメータの正本を入れない
- reducer を導入し、**非同期結果に requestId を必須付与**。現在の requestId と一致しない結果は破棄する（refinement / validation / submit のすべてに適用）

### D6. 正規化と検証の位置

正規化は**共有の純粋関数**として定義し、Renderer では早期フィードバック、Main / IPC では最終検証に使う。**Renderer の正規化結果を信頼せず、Main 側で再計算する**（品質要件「IPC は入力バリデーションを行う」）。

```ts
type ValidationResult =
  | { valid: true; request: NormalizedVideoJobRequest }
  | { valid: false; issues: readonly ValidationIssue[] };
interface ValidationIssue {
  code: "missing-prompt" | "missing-parameter" | "invalid-parameter" | "invalid-asset" | "unsupported-kind";
  field?: string; messageKey: string;
}
```

`path` は renderer 由来の任意文字列を信頼しない。Main 側で非空・想定ローカルパス・種別と拡張子の整合・許可範囲を検証する。

### D7. 表示の分類

**会話本文 (`turns`) に出す**: follow-up 質問、要約、改善ドラフト、入力不足の説明、Router の軽量設定提案、依存モデル不足の説明。
**内部状態のみ**: requestId、処理中か、操作エラーコード、validation issue の構造化情報、jobId、copyState、stale 判定。

a11y は既存方針を維持する。会話本文は `role="log"`、進捗・成功は短い `role="status"`、失敗は `role="alert"`、live region は初回レンダリングから存在、送信状態とコピー結果は `aria-label` で一意化（#19 で採用済み）。follow-up の質問本文は status に入れず、会話本文または通常のフォーム領域に置く。

### D8. VRAM 不足と無効入力

- **無効入力を黙って補正しない**。`fps: 999` を黙って 60 にしない。UI でエラー表示 → 入力保持 → 選択肢なら有効値のみ提示 → 自動補正が要る場合は補正前後を明示して承認可能にする
- **VRAM 不足は validation error ではない**。入力値の不正ではなく実行環境との適合問題のため、`RouterDiagnostic` として別の型にする
- Router は `suggested` を返せるが、composer の draft を勝手に書き換えない

### D9. IPC

`submitVideoJob(req: NormalizedVideoJobRequest)` へ移行し、型でも「正規化済み要求だけを送る」ことを表現する。ただし型だけで安全性を保証せず、Main 側で再検証する。

Router 診断を返すための戻り値拡張 (`SubmitVideoJobResult`) は**別スコープ**。41-3 の必須変更は入力の構造化と正規化済み要求の受け渡しまで。

## 結果・制約

**PR 分割** — 41-3 の最初の PR は **PR-A と PR-B の範囲まで**に限定する。

| PR | スコープ |
|---|---|
| PR-A | ADR-001 と共有型契約 (`VideoDraft` / `NormalizedVideoJobRequest` / refinement 型 / validation 型) |
| PR-B | Composer 状態モデル (reducer / turns / OperationState / requestId / stale 破棄) |
| PR-C | 構造化パラメータ UI (長さ / fps / 解像度 / 品質 / モーション強度 / 資産入力) |
| PR-D | PromptRefinementPort 拡張 (suggestedParams / follow-up 型 / 候補適用) |
| PR-E | IPC 検証 (Main 側 validation / エラーコード / 入力保持) |
| PR-F | Workflow Router 境界 (正規化要求からテンプレート選択・注入まで) |
| PR-G | Router 診断 (依存不足 / VRAM 不足 / 軽量設定提案) |

構造化フィールドの UI、Router の JSON 注入、VRAM 判定を1つの PR に入れない。

**未決事項（PR-A 前の決定ゲート）— 3件とも解決済み**

1. **範囲と許容値** → D3b のとおり、共通定数に埋め込まず capability descriptor から引く。共通で検証するのは「正整数の fps」「有限の正数の durationSec」「0–1 の motionStrength」まで
2. **モード別の必須資産** → D9b のとおり。`VideoKindRequirements` という固定表ではなく `assetRequirements` / `promptRequirement` として descriptor で表現する
3. **`RefinementQuestion` が返すもの** → ローカライズ済み文字列ではなく**意味 ID** (`{ id: "missing-source-image", fields: ["sourceImage"] }`)。Renderer が i18n キーへマップする。port が UI 文言やロケールに依存せず、6ロケール実訳ルールと両立する

### D9b. モード別の要件 (共通契約の初期値)

> **これらの既定値 (`DEFAULT_PROMPT_REQUIREMENT` / `DEFAULT_ASSET_REQUIREMENTS`) は、UI や Router の最終的な能力宣言ではない。** 具体的な `VideoCapabilityDescriptor` が未指定の場合にだけ使用する baseline である。Workflow Router は concrete descriptor を渡すことで既定値を上書きできる。これにより、`audio` の画像任意や `i2v` の prompt 任意といった安全側の共通契約を維持したまま、後続の Wan / LTX / SVD 用 descriptor が必要な制約を精密に定義できる。

| VideoKind | 共通契約で必須の資産 | 任意 | prompt |
|---|---|---|---|
| t2v | なし | — | required |
| i2v | image ×1 | prompt | optional |
| continuation | video ×1 | prompt、追加画像 | optional |
| edit | video ×1 | prompt、mask | required |
| audio | audio ×1 | **image ×1**、prompt | optional |

- **`audio` の image は共通契約では必須にしない。** Wan 2.2 S2V や LTX-2 の audio-to-video は画像+音声だが、音声のみから生成する / 音声と動画を再編集する / 画像を内部生成するテンプレートを表現できなくなるため。画像必須は個別の descriptor で宣言する
- **prompt は全モード必須にしない。** SVD のように画像・motion bucket・fps を中心に動作しテキスト prompt を取らないモデルがあるため。上表は初期値で、必須性は descriptor で変更できる
- **`edit` の mask と範囲指定は PR-A に入れない。** mask は単なる `LocalMediaAsset` ではなく (画像か動画か / 元動画とフレーム数・解像度が一致するか / 白黒の意味 / 時間範囲 / feather・dilation)、PR-A のスコープが編集機能の設計まで膨らむ。VACE が `src_video` / `src_mask` / `src_ref_images` を要求することは把握済みで、後続 PR で `VideoEditControl` として導入する
- asset の「役割」(`first-frame` / `last-frame` / `mask` / `reference` 等) も PR-A には含めず、Router 実装 PR で導入する

## PR-A 受け入れ基準

これを満たしたら実装してよい。

- `fps` は固定 union ではなく `number` として定義されている
- `durationSec` の既定値は 5 だが、共通 `max = 10` を型にも共通定数にも埋め込んでいない
- `motionStrength` は 0.0 ≤ value ≤ 1.0 で検証される
- 無効値を黙って丸めない
- `durationSec × fps` から導出されるフレーム数を `FrameCountRule` で検証できる。Wan 型の `4n+1` と LTX 型の `8n+1` を共通バリデータで表現できる
- `qualityPreset` と `resolution` は別フィールドとして保持され、実行可能な組み合わせを descriptor で表現できる
- t2v は asset なし / i2v は image 1個必須 / continuation は video 1個必須 / edit は video 1個と prompt 必須 / audio は audio 1個必須で image は任意、として検証できる
- prompt の必須性を `VideoKind` の固定条件ではなく descriptor で変更できる
- 資産は tuple ではなく `readonly LocalMediaAsset[]` で、個数は `AssetRequirement` で検証する
- `normalize` / `validate` は副作用なしの純粋関数で、Renderer と Main の両方が同じ関数を実行できる
- validation error と `RouterDiagnostic` が型上分離されている
- PR-A に composer reducer / 会話 UI / 構造化パラメータ UI / ComfyUI アダプタ / Router 実装を含めない
- 新規 UI 文言を追加する場合、6ロケールの訳語と `locales.test.ts` のテストを同じ PR に含める

## 実装対象外

- ComfyUI のノードや workflow JSON の確定
- streaming の導入
- `submitVideoJob` の戻り値拡張
- モード別 discriminated union の全要件確定
- 実バックエンドアダプタの実装

## やってはいけないこと

- `suggestedParams` をユーザー承認なしで実行値にする
- Router に `turns` を渡す
- UI に Router のテンプレート知識を埋め込む
- VRAM 不足時に自動で品質や解像度を変更する
- 不正入力を黙って丸める
- `follow-up` / `ready` / `sending` を1つの曖昧な state string に集約する
- Renderer から `ipcRenderer` や channel 名を公開する
- `submitVideoJob` と Router の実装変更を会話履歴 PR に混ぜる
- 設計承認前に IPC / Workflow Router / 永続化の実装へ着手する
