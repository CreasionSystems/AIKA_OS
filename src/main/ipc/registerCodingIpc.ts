import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { IpcMainLike } from "./registerInferenceIpc";
import type { CodingState, CodingView } from "@main/coding/codingWorkflow";

/**
 * コーディング IPC ハンドラ登録 (plan / execute / verify / rewind)。
 * preload の planCode / executeCode / verifyCode / rewindCode と対になる。
 * 各メソッドは canRewind を含む CodingView を返す。
 */

/** CodingWorkflow が満たす最小インターフェース。 */
export interface CodingIpcWorkflow {
  plan(goal: string): Promise<void>;
  execute(): void;
  verify(): void;
  rewind(): void;
  getState(): CodingState;
  canRewind(): boolean;
}

function toView(workflow: CodingIpcWorkflow): CodingView {
  return { ...workflow.getState(), canRewind: workflow.canRewind() };
}

export function registerCodingIpc(
  ipcMain: IpcMainLike,
  workflow: CodingIpcWorkflow,
): void {
  // goal は renderer 由来の untrusted 入力。空 goal は generateCodePlan が弾く。
  ipcMain.handle(IPC_CHANNELS.planCode, async (_event, goal) => {
    await workflow.plan(goal as string);
    return toView(workflow);
  });
  // execute は planned 状態でのみ可能 (CodingWorkflow.execute がガード)。
  ipcMain.handle(IPC_CHANNELS.executeCode, () => {
    workflow.execute();
    return toView(workflow);
  });
  // verify は executed 状態でのみ可能 (CodingWorkflow.verify がガード)。
  ipcMain.handle(IPC_CHANNELS.verifyCode, () => {
    workflow.verify();
    return toView(workflow);
  });
  // rewind は履歴が無いと throw (CodingWorkflow.rewind がガード)。
  ipcMain.handle(IPC_CHANNELS.rewindCode, () => {
    workflow.rewind();
    return toView(workflow);
  });
}
