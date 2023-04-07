export class EventEmitter<T> {
  private _eventHandlers: Map<T, Set<any>> = new Map();

  addEventListener(event: T, cb: any) {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)?.add(cb);
  }
  removeEventListener(event: T, cb: any) {
    this._eventHandlers.get(event)?.delete(cb);
  }
  emitEvent(event: T, ...args: any[]) {
    this._eventHandlers.get(event)?.forEach((cb) => cb(...args));
  }
}
