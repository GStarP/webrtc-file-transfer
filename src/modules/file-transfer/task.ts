import { readFileAsArrayBuffer } from "../../utils";
import { EventEmitter } from "../../utils/event-emitter";

export type FileTransferTaskEvent = "progress" | "finish";
export enum FileTransferInfoType {
  SEND,
  RECV,
}
export interface FileTransferInfo {
  type: FileTransferInfoType;
  meta: FileTransferMeta;
  progress: FileTransferProgress;
}
export interface FileTransferMeta {
  id: string;
  name: string;
  size: number;
}
export interface FileTransferProgress {
  receivedSize: number;
  rate: number;
}

export enum FileTransferMsgType {
  META,
  PROGRESS,
}
export interface FileTransferMsg<T> {
  type: FileTransferMsgType;
  data: T;
}
export type onFileTransferProgressCb = (progress: FileTransferProgress) => void;

export class FileTransferTask extends EventEmitter<FileTransferTaskEvent> {
  info: FileTransferInfo;

  protected _dc: RTCDataChannel;
  protected _tempHandlers: any[] = [];

  constructor(info: FileTransferInfo, dc: RTCDataChannel) {
    super();
    this.info = info;
    this._dc = dc;
  }

  protected _addTempHandler(handler: any) {
    this._dc.addEventListener("message", handler);
  }
  protected _cleanAllTempHandlers() {
    this._tempHandlers.forEach((cb) =>
      this._dc.removeEventListener("message", cb)
    );
    this._tempHandlers = [];
  }
  protected _finish(fileBlob?: Blob) {
    this._cleanAllTempHandlers();
    this.emitEvent("finish", fileBlob);
  }

  isTaskFinished() {
    return this.info.progress.receivedSize === this.info.meta.size;
  }
}

/**
 * @FIX sender buffer limit set to 2MB
 */
const SEND_BUFFER_LIMIT = 2 * 1024 * 1024;

export class FileTransferSendTask extends FileTransferTask {
  constructor(info: FileTransferInfo, dc: RTCDataChannel) {
    super(info, dc);
    this._setupDataChannelHandlers();
  }

  private _setupDataChannelHandlers() {
    const onMessage = (e: MessageEvent<any>) => {
      if (typeof e.data === "string") {
        const msg: FileTransferMsg<FileTransferProgress> = JSON.parse(e.data);
        if (msg.type === FileTransferMsgType.PROGRESS) {
          this.info.progress = msg.data;
          this.emitEvent("progress");

          if (this.isTaskFinished()) {
            this._finish();
          }
        }
      }
    };
    this._addTempHandler(onMessage);
  }

  async start(file: File) {
    const fileData = await readFileAsArrayBuffer(file);
    this._sendFileMeta(this.info.meta);
    this._sendFileData(fileData);
  }
  private _sendFileMeta(meta: FileTransferMeta) {
    const msg: FileTransferMsg<FileTransferMeta> = {
      type: FileTransferMsgType.META,
      data: meta,
    };
    this._dc.send(JSON.stringify(msg));
  }
  private _sendFileData(data: ArrayBuffer) {
    try {
      /**
       *  data size per chunk should be less than 16KB
       *  @ref https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#concerns_with_large_messages
       */
      const MAX_CHUNK_SIZE = 16 * 1024;
      /**
       * @tips prepare data in form of chunks
       * slice in `queueDataToSend` will cause time consuming
       * which slows down transferring rate
       */
      const chunkNum = Math.ceil(data.byteLength / MAX_CHUNK_SIZE);
      const chunks = new Array(chunkNum).fill(0);
      for (let i = 0; i < chunkNum; i++) {
        const chunk = data.slice(
          i * MAX_CHUNK_SIZE,
          Math.min((i + 1) * MAX_CHUNK_SIZE, data.byteLength)
        );
        chunks[i] = chunk;
      }
      /**
       * send too many chunks will cause queue to be full
       * @ref https://stackoverflow.com/questions/71285807/i-am-trying-to-share-a-file-over-webrtc-but-after-some-time-it-stops-and-log-rt
       */
      let chunkToSend = 0;
      const queueDataToSend = () => {
        while (chunkToSend < chunkNum) {
          // if data in buffer over threshold, refuse to send
          // until data fall below threshold
          if (this._dc.bufferedAmount > SEND_BUFFER_LIMIT) {
            this._dc.onbufferedamountlow = () => {
              this._dc.onbufferedamountlow = null;
              queueDataToSend();
            };
            return;
          }
          this._dc.send(chunks[chunkToSend]);
          chunkToSend++;
        }
      };
      queueDataToSend();
    } catch (e) {
      console.error("send data error", e);
    }
  }
}

export class FileTransferRecvTask extends FileTransferTask {
  private _buffer: ArrayBuffer[] = [];

  private _lastReceivedTime = Date.now();
  private _lastReceivedSize = 0;

  constructor(info: FileTransferInfo, dc: RTCDataChannel) {
    super(info, dc);
    this._setupDataChannelHandlers();
  }
  private _setupDataChannelHandlers() {
    const onMessage = (e: MessageEvent<any>) => {
      if (typeof e.data !== "string") {
        this._recvFileData(e.data);
      }
    };
    this._addTempHandler(onMessage);
  }

  private _recvFileData(data: ArrayBuffer) {
    this._buffer.push(data);
    this.info.progress.receivedSize += data.byteLength;
    /**
     * @tips too frequent update is unnecessary
     * and can cause data channel block
     */
    const now = Date.now();
    const timeDiff = now - this._lastReceivedTime;
    if (timeDiff >= 500 || this.isTaskFinished()) {
      this._updateProgress(timeDiff);
    }
    // if recv complete file, fire finish event with file blob
    if (this.isTaskFinished()) {
      this._finish(new Blob(this._buffer));
    }
  }
  private _updateProgress(timeDiff: number) {
    // calculate rate (bytes/s)
    this.info.progress.rate =
      ((this.info.progress.receivedSize - this._lastReceivedSize) / timeDiff) *
      1000;
    this._lastReceivedTime = Date.now();
    this._lastReceivedSize = this.info.progress.receivedSize;
    // fire local event
    this.emitEvent("progress");
    // update remote progress
    const progressMsg = {
      type: FileTransferMsgType.PROGRESS,
      data: this.info.progress,
    };
    this._dc.send(JSON.stringify(progressMsg));
  }
}
