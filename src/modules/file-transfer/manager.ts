import { EventEmitter } from "../../utils/event-emitter";
import { DataChannelPool } from "./data-channel-pool";
import { v4 as uuid } from "uuid";
import {
  FileTransferInfoType,
  FileTransferMeta,
  FileTransferMsg,
  FileTransferRecvTask,
  FileTransferSendTask,
} from "./task";

export type FileTransferManagerEvent =
  | "ready"
  | "close"
  | "task"
  | "task-progress"
  | "task-finish";

export class FileTransferManager extends EventEmitter<FileTransferManagerEvent> {
  private _dataChannelPool: DataChannelPool;
  private _sendTasks: Map<string, FileTransferSendTask> = new Map();
  private _recvTasks: Map<string, FileTransferRecvTask> = new Map();

  constructor(dataChannelPool: DataChannelPool) {
    super();
    this._dataChannelPool = dataChannelPool;
    this._setupDCPHandlers();
  }

  private _setupDCPHandlers() {
    this._dataChannelPool.addEventListener("ready", () => {
      this.emitEvent("ready");
    });
    this._dataChannelPool.addEventListener("close", () => {
      this.emitEvent("close");
    });
    /**
     * @FIX not a good design
     * when free data channel receives message
     * means peer send file, need to recv in local
     */
    this._dataChannelPool.addEventListener(
      "free-message",
      (e: { dc: RTCDataChannel; event: MessageEvent<any> }) => {
        const { dc, event } = e;
        if (typeof event.data === "string") {
          // meta
          const msg: FileTransferMsg<FileTransferMeta> = JSON.parse(event.data);
          const meta = msg.data;
          const id = meta.id;
          const task = new FileTransferRecvTask(
            {
              type: FileTransferInfoType.RECV,
              meta,
              progress: {
                receivedSize: 0,
                rate: 0,
              },
            },
            dc
          );
          this._recvTasks.set(id, task);

          task.addEventListener("progress", () => {
            this.emitEvent("task-progress", this._recvTasks.get(id)!.info);
          });
          task.addEventListener("finish", (blob: Blob) => {
            this._recvTasks.delete(id);
            this.emitEvent("task-finish", { info: task.info, blob });
            // no need to `retDataChannel`, only send will call `getDataChannel`
          });

          this.emitEvent("task", task.info);
        }
      }
    );
  }

  send(file: File) {
    const dc = this._dataChannelPool.getDataChannel();
    if (!dc) {
      alert("no data channel available");
      return;
    }

    const id = uuid();
    const task = new FileTransferSendTask(
      {
        type: FileTransferInfoType.SEND,
        meta: {
          id,
          name: file.name,
          size: file.size,
        },
        progress: {
          receivedSize: 0,
          rate: 0,
        },
      },
      dc
    );
    this._sendTasks.set(id, task);

    task.addEventListener("progress", () => {
      this.emitEvent("task-progress", this._sendTasks.get(id)!.info);
    });
    task.addEventListener("finish", () => {
      this._sendTasks.delete(id);
      this._dataChannelPool.retDataChannel(dc);
    });

    task.start(file);
    this.emitEvent("task", task.info);
  }
}
