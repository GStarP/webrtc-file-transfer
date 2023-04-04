# WebRTC File Transfer

Use WebRTC [DataChannel API](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel) to implement p2p file transfer.

## Quick Start

Install dependencies.

```
pnpm install
```

Launch signaling server.

```
pnpm run server
```

Launch web app.

```
pnpm dev
```

## Future Work

- [ ] show transferring progress in both sides
- [ ] test with large file (more than 1 GB)
- [ ] test in LAN
- [ ] parallel file transferring
