import {
  connectSignalingServer,
  join,
  onRecvAnswer,
  onRecvIce,
  onRecvOffer,
  sendAnwer,
  sendIce,
  sendOffer,
} from "../signaling";
import { DataChannelPool } from "./data-channel-pool";
import { FileTransferManager } from "./manager";

/**
 * WebRTC DataChannel connecting flow
 */
export function startFileTransferAsProducer(onPin: (pin: number) => void) {
  const socket = connectSignalingServer();
  // 1. producer join and create pin
  join(socket).then((pin) => onPin(pin));

  const pc = new RTCPeerConnection();
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendIce(socket, e.candidate);
    }
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

  return new FileTransferManager(new DataChannelPool(pc, { passive: true }));
}

export function startFileTransferAsConsumer(pin: number) {
  const socket = connectSignalingServer();
  // 2. consumer join with pin
  join(socket, pin).then(async () => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.debug("consumer set local desc", offer.sdp);

    // 3. consumer send offer
    sendOffer(socket, offer.sdp || "");
  });

  const pc = new RTCPeerConnection();
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendIce(socket, e.candidate);
    }
  };

  // 6. consumer recv answer
  onRecvAnswer(socket, async (answerSdp: string) => {
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: answerSdp })
    );
    console.debug("consumer set remote desc", answerSdp);
  });
  onRecvIce(socket, createOnRecvIceCb(pc));

  return new FileTransferManager(new DataChannelPool(pc));
}

function createOnRecvIceCb(pc: RTCPeerConnection) {
  return async (candidate: RTCIceCandidate) => {
    await pc.addIceCandidate(candidate);
    console.debug("add ice candidate", pc, candidate);
  };
}

export { FileTransferManager } from "./manager";
