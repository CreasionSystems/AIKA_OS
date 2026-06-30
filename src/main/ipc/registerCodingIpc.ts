import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { IpcMainLike } from "./registerInferenceIpc";
import type { CodingState } from "@main/coding/codingWorkflow";

/**
 * コーディング IPC ハンドラ登録 (plan 縦切り)。
 * preload の planCode と対になり、CodingWorkflow.plan を結線する。
 * execute / verify / rewind は後続の縦切りで追加する。
 */

/** CodingWorkflow が満たす最小インターフェース (plan / execute / verify 段階)。 */
export interface CodingIpcWorkflow {
  plan(goal: string): Promise<void>;
  execute(): void;
  verify(): void;
  getState(): CodingState;
}

export function registerCodingIpc(
  ipcMain: IpcMainLike,
  workflow: CodingIpcWorkflow,
): void {
  // goal は renderer 由来の untrusted 入力。空 goal は generateCodePlan が弾く。
  ipcMain.handle(IPC_CHANNELS.planCode, async (_event, goal) => {
    await workflow.plan(goal as string);
    return workflow.getState();
  });
  // execute は planned 状態でのみ可能 (CodingWorkflow.execute がガード)。
  ipcMain.handle(IPC_CHANNELS.executeCode, () => {
    workflow.execute();
    return workflow.getState();
  });
  // verify は executed 状態でのみ可能 (CodingWorkflow.verify がガード)。
  ipcMain.handle(IPC_CHANNELS.verifyCode, () => {
    workflow.verify();
    return workflow.getState();
  });
}
