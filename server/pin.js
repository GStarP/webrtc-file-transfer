const usedPin = new Set();

export function mallocPin() {
  let pin = Math.floor(Math.random() * 9000) + 1000;
  const self = pin;
  while (usedPin.has(pin)) {
    pin = (pin + 1) % 10000;
    if (pin === self) throw new Error("No available pin");
  }
  return pin;
}

export function freePin(pin) {
  usedPin.delete(pin);
}
