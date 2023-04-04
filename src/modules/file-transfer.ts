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

export interface FileMeta {
  name: string;
  size: number;
}

export class FileTramsferInfo {
  name: string;
  size: number;
  receivedSize: number = 0;

  private _buffer: ArrayBuffer[];

  constructor(meta: FileMeta) {
    this.name = meta.name;
    this.size = meta.size;
    this._buffer = [];
  }

  appendData(data: ArrayBuffer) {
    this._buffer.push(data);
    this.receivedSize += data.byteLength;
    if (this.receivedSize === this.size) {
      return new Blob(this._buffer);
    }
  }
}

export enum FileTransferState {
  OPEN,
  CLOSED,
}
export class FileTransfer {
  state = FileTransferState.OPEN;

  _dc: RTCDataChannel;
  _sendInfo: FileTramsferInfo | null = null;
  _recvInfo: FileTramsferInfo | null = null;

  constructor(dc: RTCDataChannel) {
    this._dc = dc;
  }

  /**
   * send
   */
  async sendFile(file: File) {
    this._checkState();

    const fileMeta: FileMeta = { name: file.name, size: file.size };
    const fileData = await readFileAsArrayBuffer(file);

    this._sendInfo = new FileTramsferInfo(fileMeta);
    this._sendFileMeta(fileMeta);
    this._sendFileData(fileData);
  }
  private _sendFileMeta(meta: FileMeta) {
    this._dc.send(JSON.stringify(meta));
  }
  private _sendFileData(data: ArrayBuffer) {
    try {
      /**
       *  data size per chunk should be less than 16KB
       *  @ref https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#concerns_with_large_messages
       */
      const MAX_CHUNK_SIZE = 16 * 1024;
      const chunkNum = Math.ceil(data.byteLength / MAX_CHUNK_SIZE);
      for (let i = 0; i < chunkNum; i++) {
        const start = i * MAX_CHUNK_SIZE;
        const end = Math.min(start + MAX_CHUNK_SIZE, data.byteLength);
        const chunk = data.slice(start, end);
        this._dc.send(chunk);
      }
    } catch (e) {
      console.error("send data error", e);
    }
  }
  isSending() {
    return !!this._sendInfo;
  }

  /**
   * recv
   */
  recvFileMeta(meta: FileMeta) {
    this._checkState();
    this._recvInfo = new FileTramsferInfo(meta);
  }
  recvFileData(data: ArrayBuffer) {
    this._checkState();
    if (this.isReceiving()) {
      const blob = this._recvInfo!.appendData(data);
      if (blob) this._recvFileFinish(blob);
    } else {
      console.error("no file transfer in progress");
    }
  }
  private _recvFileFinish(completeFileData: Blob) {
    downloadBlob(completeFileData, this._recvInfo!.name);
    this._recvInfo = null;
  }
  isReceiving() {
    return !!this._recvInfo;
  }

  private _checkState() {
    if (this.state === FileTransferState.CLOSED) {
      throw new Error("file transfer closed");
    }
  }
  close() {
    this.state = FileTransferState.CLOSED;
    this._sendInfo = null;
    this._recvInfo = null;
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
  dc.onmessage = (e) => {
    if (typeof e.data === "string") {
      console.debug("recv file meta", e.data);
      // file meta data: JSON string
      const meta: FileMeta = JSON.parse(e.data);
      ft.recvFileMeta(meta);
    } else {
      console.debug("recv file data", e.data);
      // file data: ArrayBuffer
      ft.recvFileData(e.data as ArrayBuffer);
    }
  };
}

function createOnRecvIceCb(pc: RTCPeerConnection) {
  return async (candidate: RTCIceCandidate) => {
    await pc.addIceCandidate(candidate);
    console.debug("add ice candidate", pc, candidate);
  };
}
