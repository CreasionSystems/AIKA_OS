import type { CodePlanRequest, CodePlanResult } from "@shared/inference/port";

/**
 * コーディング支援の骨格 (Plan / Execute / Verify / Rewind)。
 *
 * 純粋な状態機械。phase は idle -> planned -> executed -> verified と進み、
 * 各操作は直前状態を履歴に積む。rewind は履歴を1手戻す (undo)。
 *
 * 計画生成は注入された CodePlanner (InferenceService 等) に委譲する。
 * execute / verify の実体は当面スタブ (実行系は後続)。
 */

export type CodingPhase = "idle" | "planned" | "executed" | "verified";

/** plan を生成できる依存 (InferenceService が満たす)。 */
export interface CodePlanner {
  generateCodePlan(req: CodePlanRequest): Promise<CodePlanResult>;
}

export interface VerificationResult {
  passed: boolean;
  notes: string[];
}

export interface CodingState {
  phase: CodingPhase;
  goal?: string;
  plan?: CodePlanResult;
  executionLog?: string[];
  verification?: VerificationResult;
}

const INITIAL_STATE: CodingState = { phase: "idle" };

export class CodingWorkflow {
  private state: CodingState = INITIAL_STATE;
  private readonly history: CodingState[] = [];

  constructor(private readonly planner: CodePlanner) {}

  getState(): CodingState {
    return this.state;
  }

  canRewind(): boolean {
    return this.history.length > 0;
  }

  /** 直前状態を履歴へ積んでから新状態へ遷移する。 */
  private transition(next: CodingState): void {
    this.history.push(this.state);
    this.state = next;
  }

  /** Plan: 計画を生成し planned へ。idle / 既存状態からの再計画も許可。 */
  async plan(goal: string): Promise<void> {
    const plan = await this.planner.generateCodePlan({ goal });
    this.transition({ phase: "planned", goal, plan });
  }

  /** Execute: planned からのみ。スタブの実行ログを残す。 */
  execute(): void {
    if (this.state.phase !== "planned") {
      throw new Error(
        `execute は planned 状態でのみ可能です (現在: ${this.state.phase})`,
      );
    }
    const executionLog = (this.state.plan?.steps ?? []).map(
      (s) => `executed: ${s.title}`,
    );
    this.transition({ ...this.state, phase: "executed", executionLog });
  }

  /** Verify: executed からのみ。スタブの検証結果を残す。 */
  verify(): void {
    if (this.state.phase !== "executed") {
      throw new Error(
        `verify は executed 状態でのみ可能です (現在: ${this.state.phase})`,
      );
    }
    const verification: VerificationResult = {
      passed: true,
      notes: ["verified (stub)"],
    };
    this.transition({ ...this.state, phase: "verified", verification });
  }

  /** Rewind: 履歴を1手戻す。履歴が無ければ throw。 */
  rewind(): void {
    const previous = this.history.pop();
    if (previous === undefined) {
      throw new Error("これ以上 rewind できません");
    }
    this.state = previous;
  }
}
