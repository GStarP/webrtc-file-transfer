import { EventEmitter } from "../../utils/event-emitter";

export interface DataChannelPoolProps {
  passive?: boolean;
  size?: number;
}
const DEFAULT_DATA_CHANNEL_POOL_PROPS = {
  passive: false,
  size: 3,
};

export type DataChannelPoolEvent = "ready" | "free-message" | "close";

export class DataChannelPool extends EventEmitter<DataChannelPoolEvent> {
  private _pc: RTCPeerConnection;
  private _pool: Map<string, RTCDataChannel> = new Map();
  private _free: string[] = [];

  /**
   * max data channel num
   */
  readonly size: number;

  constructor(pc: RTCPeerConnection, props?: DataChannelPoolProps) {
    super();
    this._pc = pc;

    const { passive, size } = { ...DEFAULT_DATA_CHANNEL_POOL_PROPS, ...props };
    this.size = size;

    this._setupPCHandlers();
    this._initDataChannels(passive);
  }

  private _setupPCHandlers() {
    this._pc.addEventListener("connectionstatechange", () => {
      if (this._pc.connectionState === "disconnected") {
        this.close();
        this.emitEvent("close");
      }
    });
  }

  private _initDataChannels(passive: boolean) {
    if (!passive) {
      // not passive: create data channel
      const promises = [];
      for (let i = 0; i < this.size; i++) {
        promises.push(
          new Promise<void>((resolve, reject) => {
            const dc = this._pc.createDataChannel(`dc-${i}`);
            this.setupDCHandlers(dc);
            dc.addEventListener("open", () => {
              resolve();
            });
          })
        );
      }
      // all data channel open => ready
      return Promise.all(promises).then(() => {
        this.emitEvent("ready");
      });
    } else {
      // passive: recv data channel from ondatachannel cb
      let readyNum = 0;

      this._pc.ondatachannel = (e) => {
        const dc = e.channel;
        this.setupDCHandlers(dc);
        dc.addEventListener("open", () => {
          readyNum++;
          if (readyNum === this.size) {
            this.emitEvent("ready");
          }
        });
      };
    }
  }

  private setupDCHandlers(dc: RTCDataChannel) {
    dc.binaryType = "arraybuffer";
    dc.addEventListener("open", () => {
      this._pool.set(dc.label, dc);
      this._free.push(dc.label);
    });
    dc.onmessage = (e) => {
      if (typeof e.data === "string")
        console.debug(`dc[${dc.label}].onmessage:`, e.data);
      /**
       * @FIX not a good design
       * only when data channel is free, emit free-message event
       * can reduce `JSON.parse` cost
       */
      if (this._free.indexOf(dc.label) !== -1) {
        this.emitEvent("free-message", { dc, event: e });
      }
    };
  }

  close() {
    this._pool.forEach((dc) => {
      dc.close();
    });
    this._pool.clear();
    this._free = [];
  }

  /**
   * get free data channel
   */
  getDataChannel() {
    if (this._free.length === 0) return;
    return this._pool.get(this._free.shift()!)!;
  }
  /**
   * return unused data channel
   */
  retDataChannel(dc: RTCDataChannel) {
    const label = dc.label;
    if (!this._pool.has(label)) {
      console.error("no such data channel:", label);
      return;
    }
    this._free.push(label);
  }

  freeNum() {
    return this._free.length;
  }
}
