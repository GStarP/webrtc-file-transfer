import { downloadBlob, readFileAsArrayBuffer } from "../utils";
import {
  connectSignalingServer,
  join,
  onRecvAnswer,
  onRecvIce,
  onRecvOffer,
  sendAnwer,
  sendIce,
  sendOffer,
} from "./signaling";

/**
 * WebRTC DataChannel connecting flow
 */
export function startFileTransferAsProducer(
  onPin: (pin: number) => void,
  onReady: onFileTransferReadyCb
) {
  const socket = connectSignalingServer();
  // 1. producer join and create pin
  join(socket).then((pin) => onPin(pin));

  const pc = new RTCPeerConnection();
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendIce(socket, e.candidate);
    }
  };
  pc.ondatachannel = (e) => {
    setupFileTransfer(e.channel, (ft) => {
      socket.close();
      onReady(ft);
    });
  };
  // 4. producer recv offer
  onRecvOffer(socket, async (offerSdp: string) => {
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "offer", sdp: offerSdp })
    );
    console.debug("producer set remote desc", offerSdp);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.debug("producer set local desc", answer.sdp);

    // 5. producer send answer
    sendAnwer(socket, answer.sdp || "");
  });
  onRecvIce(socket, createOnRecvIceCb(pc));
}

export function startFileTransferAsConsumer(
  pin: number,
  onReady: onFileTransferReadyCb
) {
  const socket = connectSignalingServer();
  // 2. consumer join with pin
  join(socket, pin).then(async () => {
    const pc = new RTCPeerConnection();
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendIce(socket, e.candidate);
      }
    };
    const dc = pc.createDataChannel("file-transfer");
    setupFileTransfer(dc, onReady);

    // 6. consumer recv answer
    onRecvAnswer(socket, async (answerSdp: string) => {
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: answerSdp })
      );
      console.debug("consumer set remote desc", answerSdp);
    });
    onRecvIce(socket, createOnRecvIceCb(pc));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.debug("consumer set local desc", offer.sdp);

    // 3. consumer send offer
    sendOffer(socket, offer.sdp || "");
  });
}

/**
 * Type
 */

export enum FileTransferMsgType {
  META,
  PROGRESS,
}
export interface FileTransferMsg<T> {
  type: FileTransferMsgType;
  data: T;
}
export interface FileTransferMeta {
  name: string;
  size: number;
}

export interface FileTransferProgress {
  receivedSize: number;
  rate: number;
}
export type onFileTransferProgressCb = (progress: FileTransferProgress) => void;

export enum FileTransferState {
  OPEN,
  CLOSED,
}

/**
 * Class
 */

export class FileTramsferInfo {
  name: string;
  size: number;
  receivedSize: number = 0;

  private _buffer: ArrayBuffer[];
  private _lastRecvTime: number = Date.now();
  private _lastRecvSize: number = 0;

  constructor(meta: FileTransferMeta) {
    this.name = meta.name;
    this.size = meta.size;
    this._buffer = [];
  }

  appendData(data: ArrayBuffer) {
    this._buffer.push(data);
    this.receivedSize += data.byteLength;

    // if full data received, return file blob
    if (this.receivedSize === this.size) {
      return new Blob(this._buffer);
    }
  }

  updateRate(): FileTransferProgress | undefined {
    const now = Date.now();
    const timeDiff = now - this._lastRecvTime;
    // @FIX avoid too frequent update
    if (timeDiff > 200 || this.receivedSize === this.size) {
      const progress = {
        receivedSize: this.receivedSize,
        rate: ((this.receivedSize - this._lastRecvSize) / timeDiff) * 1000,
      };
      this._lastRecvSize = this.receivedSize;
      this._lastRecvTime = now;
      return progress;
    }
  }
}

export class FileTransfer {
  sendInfo: FileTramsferInfo | null = null;
  recvInfo: FileTramsferInfo | null = null;

  private _dc: RTCDataChannel;
  // at most 2MB data in buffer
  private _sendBufferLimit: number = 2 * 1024 * 1024;
  private _sendBufferLowThreshold: number = 1;

  /**
   * event listeners
   */
  onSendProgress: Set<onFileTransferProgressCb> = new Set();
  onRecvProgress: Set<onFileTransferProgressCb> = new Set();

  constructor(dc: RTCDataChannel) {
    this._dc = dc;
    this._dc.bufferedAmountLowThreshold = this._sendBufferLowThreshold;
  }

  handleDataChannelMsg(e: MessageEvent<any>) {
    if (typeof e.data === "string") {
      console.debug("recv msg", e.data);
      // msg: JSON string
      const msg: FileTransferMsg<unknown> = JSON.parse(e.data);
      if (msg.type === FileTransferMsgType.META) {
        this._recvFileMeta((msg as FileTransferMsg<FileTransferMeta>).data);
      } else if (msg.type === FileTransferMsgType.PROGRESS) {
        this._recvFileProgress(
          (msg as FileTransferMsg<FileTransferProgress>).data
        );
      }
    } else {
      console.debug("recv file data", e.data);
      // file data: ArrayBuffer
      this._recvFileData(e.data as ArrayBuffer);
    }
  }

  /**
   * send
   */
  async sendFile(file: File) {
    const fileMeta: FileTransferMeta = {
      name: file.name,
      size: file.size,
    };
    const fileData = await readFileAsArrayBuffer(file);

    this.sendInfo = new FileTramsferInfo(fileMeta);
    this._sendFileMeta(fileMeta);
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
      // prepare data in form of chunks
      // slice in `queueDataToSend` will cause time consuming
      // which slows down transferring rate
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
          if (this._dc.bufferedAmount > this._sendBufferLimit) {
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
  isSending() {
    return !!this.sendInfo;
  }

  /**
   * recv
   */
  private _recvFileMeta(meta: FileTransferMeta) {
    this.recvInfo = new FileTramsferInfo(meta);
  }
  private _recvFileData(data: ArrayBuffer) {
    if (this.isReceiving()) {
      const blob = this.recvInfo!.appendData(data);

      const progress = this.recvInfo!.updateRate();
      if (progress) {
        // call onRecvProgressCb
        this.onRecvProgress.forEach((cb) => cb(progress));
        // then tell progress to the sender
        // const msg: FileTransferMsg<FileTransferProgress> = {
        //   type: FileTransferMsgType.PROGRESS,
        //   data: progress,
        // };
        // this._dc.send(JSON.stringify(msg));
      }

      if (blob) this._recvFileFinish(blob);
    } else {
      console.error("no file transfer in progress");
    }
  }
  private _recvFileProgress(progress: FileTransferProgress) {
    if (this.isSending()) {
      // call onSendProgressCb
      this.onSendProgress.forEach((cb) => cb(progress));
    }
  }
  private _recvFileFinish(completeFileData: Blob) {
    downloadBlob(completeFileData, this.recvInfo!.name);
    this.recvInfo = null;
  }
  isReceiving() {
    return !!this.recvInfo;
  }

  close() {
    this.sendInfo = null;
    this.recvInfo = null;
  }
}

export type onFileTransferReadyCb = (ft: FileTransfer) => void;

export function setupFileTransfer(
  dc: RTCDataChannel,
  onFileTransferReady: onFileTransferReadyCb
) {
  const ft = new FileTransfer(dc);

  dc.binaryType = "arraybuffer";
  dc.onopen = () => {
    onFileTransferReady(ft);
    console.debug("data channel open", dc);
  };
  dc.onclose = () => {
    ft.close();
    console.debug("data channel close", dc);
  };
  dc.onmessage = (e) => ft.handleDataChannelMsg(e);
}

function createOnRecvIceCb(pc: RTCPeerConnection) {
  return async (candidate: RTCIceCandidate) => {
    await pc.addIceCandidate(candidate);
    console.debug("add ice candidate", pc, candidate);
  };
}
