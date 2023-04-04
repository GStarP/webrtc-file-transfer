import { useState, ChangeEvent, useRef } from "react";
import {
  FileTransfer,
  startFileTransferAsConsumer,
  startFileTransferAsProducer,
} from "./modules/file-transfer";

function App() {
  const [pinToShow, setPinToShow] = useState("no pin");
  const [pinInput, setPinInput] = useState("");
  const [fileName, setFileName] = useState("no file");
  const [fileSize, setFileSize] = useState(0);
  const [fileType, setFileType] = useState("");

  const fileTransfer = useRef<FileTransfer | null>(null);

  async function startProducer() {
    startFileTransferAsProducer(
      (pin) => {
        setPinToShow(pin + "");
      },
      (ft) => {
        fileTransfer.current = ft;
      }
    );
  }

  async function startConsumer() {
    startFileTransferAsConsumer(parseInt(pinInput), (ft) => {
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
      <div>
        <div>{pinToShow}</div>
        <button onClick={() => startProducer()}>Producer</button>
      </div>
      <div>
        <input
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
        ></input>
        <button onClick={() => startConsumer()}>Consumer</button>
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
