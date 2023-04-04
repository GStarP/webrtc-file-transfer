import { Socket, io } from "socket.io-client";

// @TODO dynamic signaling server
let signalingServerAddress = "wss://127.0.0.1:3001";
// @TODO share with server
export const EVENT_PIN = "pin";
export const EVENT_OFFER = "offer";
export const EVENT_ANSWER = "answer";
export const EVENT_ICE = "ice";

export function connectSignalingServer() {
  const socket = io(signalingServerAddress);
  return socket;
}

export async function join(socket: Socket, pin?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.emit(EVENT_PIN, pin, (pin: number) => {
      resolve(pin);
    });
  });
}

export async function sendOffer(socket: Socket, offerSdp: string) {
  socket.emit(EVENT_OFFER, offerSdp);
}
export function onRecvOffer(socket: Socket, cb: (offerSdp: string) => void) {
  socket.on(EVENT_OFFER, cb);
}

export function sendAnwer(socket: Socket, answerSdp: string) {
  socket.emit(EVENT_ANSWER, answerSdp);
}
export function onRecvAnswer(socket: Socket, cb: (answerSdp: string) => void) {
  socket.on(EVENT_ANSWER, cb);
}

export function sendIce(socket: Socket, ice: RTCIceCandidate) {
  socket.emit(EVENT_ICE, ice);
}
export function onRecvIce(socket: Socket, cb: (ice: RTCIceCandidate) => void) {
  socket.on(EVENT_ICE, cb);
}
