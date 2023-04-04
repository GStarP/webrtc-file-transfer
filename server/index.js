import { createServer } from "https";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { mallocPin, freePin } from "./pin.js";

/**
 * const
 */
const PORT = 3001;

const EVENT_PIN = "pin";
const EVENT_OFFER = "offer";
const EVENT_ANSWER = "answer";
const EVENT_ICE = "ice";

/**
 * create server
 */
function absolutePath(relativePath) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, relativePath);
}

const httpsServer = createServer({
  key: readFileSync(absolutePath("./cert/key.pem")),
  cert: readFileSync(absolutePath("./cert/cert.pem")),
});
const io = new Server(httpsServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", onSocketConnect);

httpsServer.listen(PORT, () => {
  console.log(`server listening on https://127.0.0.1:${PORT}`);
});

/**
 * manage socket clients
 */
const pinMap = new Map();

function onSocketConnect(socket) {
  // @TEST
  socket.onAny((event, ...args) => {
    console.debug(event, "\n", args);
  });
  /**
   * EVENT_PIN
   * @data pin, for producer it's undefined
   */
  socket.on(EVENT_PIN, (pin, callback) => {
    const isProducer = pin === null;
    if (isProducer) {
      pin = mallocPin();
      pinMap.set(pin, {
        producer: socket,
        consumer: null,
      });
    } else {
      pinMap.get(pin).consumer = socket;
    }

    socket.data.pin = pin;
    socket.data.isProducer = isProducer;
    callback(pin);
  });

  /**
   * EVENT_OFFER
   * @data offer sdp
   */
  socket.on(EVENT_OFFER, (sdp) => {
    pinMap.get(socket.data.pin).producer.emit(EVENT_OFFER, sdp);
  });

  /**
   * EVENT_ANSWER
   * @data answer sdp
   */
  socket.on(EVENT_ANSWER, (sdp) => {
    pinMap.get(socket.data.pin).consumer.emit(EVENT_ANSWER, sdp);
  });

  /**
   * EVENT_ICE
   * @data ice candidate
   */
  socket.on(EVENT_ICE, (candidate) => {
    const pin = socket.data.pin;
    const isProducer = socket.data.isProducer;
    const peer = isProducer
      ? pinMap.get(pin).consumer
      : pinMap.get(pin).producer;
    peer?.emit(EVENT_ICE, candidate);
  });

  /**
   * if producer manualy disconnect, free pin
   */
  socket.on("disconnect", (reason) => {
    if (reason === "client namespace disconnect" && socket.data.isProducer) {
      const pin = socket.data.pin;
      pinMap.get(pin).consumer?.disconnect(true);
      freePin(pin);
      pinMap.delete(pin);
    }
  });
}
