import { useState, ChangeEvent, useRef } from "react";
import {
  FileTransfer,
  startFileTransferAsConsumer,
  startFileTransferAsProducer,
} from "./modules/file-transfer";

function App() {
  const [pinToShow, setPinToShow] = useState("no pin");
  const [pinInput, setPinInput] = useState("");

  const [sendPercent, setSendPercent] = useState(0);
  const [sendRate, setSendRate] = useState(0);
  const [recvPercent, setRecvPercent] = useState(0);
  const [recvRate, setRecvRate] = useState(0);

  const [fileName, setFileName] = useState("no file");
  const [fileSize, setFileSize] = useState(0);
  const [fileType, setFileType] = useState("");

  const fileTransfer = useRef<FileTransfer | null>(null);

  function setProgressHandlers(ft: FileTransfer) {
    ft.onSendProgress.add((progress) => {
      setSendPercent((progress.receivedSize / ft.sendInfo!.size) * 100);
      setSendRate(progress.rate / 1000);
    });
    ft.onRecvProgress.add((progress) => {
      setRecvPercent((progress.receivedSize / ft.recvInfo!.size) * 100);
      setRecvRate(progress.rate / 1000);
    });
  }

  async function startProducer() {
    startFileTransferAsProducer(
      (pin) => {
        setPinToShow(pin + "");
      },
      (ft) => {
        setProgressHandlers(ft);
        fileTransfer.current = ft;
      }
    );
  }

  async function startConsumer() {
    startFileTransferAsConsumer(parseInt(pinInput), (ft) => {
      setProgressHandlers(ft);
      fileTransfer.current = ft;
    });
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setFileSize(file.size);
      setFileType(file.type);
      if (fileTransfer.current) {
        fileTransfer.current.sendFile(file);
      }
    }
  }

  return (
    <div className="App">
      <div style={{ marginBottom: 16 }}>
        <div>{pinToShow}</div>
        <button onClick={() => startProducer()}>Producer</button>
        <div>Send Percent: {sendPercent.toFixed(2)}%</div>
        <div>Send Rate: {sendRate.toFixed(2)}KB/s</div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
        ></input>
        <button onClick={() => startConsumer()}>Consumer</button>
        <div>Recv Percent: {recvPercent.toFixed(2)}%</div>
        <div>Recv Rate: {recvRate.toFixed(2)}KB/s</div>
      </div>
      <div>
        <div>{fileName}</div>
        <div>{fileSize} bytes</div>
        <div>{fileType}</div>
        <input type="file" onChange={(e) => onFileChange(e)}></input>
      </div>
    </div>
  );
}

export default App;
