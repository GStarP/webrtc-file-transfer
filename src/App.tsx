import { useState, ChangeEvent, useRef } from "react";
import {
  startFileTransferAsConsumer,
  startFileTransferAsProducer,
  FileTransferManager,
} from "./modules/file-transfer";
import {
  FileTransferInfo,
  FileTransferInfoType,
} from "./modules/file-transfer/task";
import { downloadBlob } from "./utils";

function App() {
  const [pinToShow, setPinToShow] = useState("no pin");
  const [pinInput, setPinInput] = useState("");

  const [sendTasks, setSendTasks] = useState<FileTransferInfo[]>([]);
  const [recvTasks, setRecvTasks] = useState<FileTransferInfo[]>([]);

  const fileTransferManger = useRef<FileTransferManager | null>(null);

  async function startProducer() {
    fileTransferManger.current = startFileTransferAsProducer((pin) => {
      setPinToShow(pin + "");
    });
    setupFTM(fileTransferManger.current);
  }
  async function startConsumer() {
    fileTransferManger.current = startFileTransferAsConsumer(
      parseInt(pinInput)
    );
    setupFTM(fileTransferManger.current);
  }

  function setupFTM(ftm: FileTransferManager) {
    ftm.addEventListener("task", (info: FileTransferInfo) => {
      if (info.type === FileTransferInfoType.SEND) {
        setSendTasks((tasks) => [...tasks, info]);
      } else {
        setRecvTasks((tasks) => [...tasks, info]);
      }
    });

    ftm.addEventListener("task-progress", (info: FileTransferInfo) => {
      if (info.type === FileTransferInfoType.SEND) {
        setSendTasks((tasks) =>
          tasks.map((task) => {
            if (task.meta.id === info.meta.id) {
              return info;
            }
            return task;
          })
        );
      } else {
        setRecvTasks((tasks) =>
          tasks.map((task) => {
            if (task.meta.id === info.meta.id) {
              return info;
            }
            return task;
          })
        );
      }
    });

    ftm.addEventListener(
      "task-finish",
      (res: { info: FileTransferInfo; blob: Blob }) => {
        downloadBlob(res.blob, res.info.meta.name);
      }
    );
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (fileTransferManger.current) {
        fileTransferManger.current.send(file);
      }
    }
  }

  return (
    <div className="App">
      <div style={{ marginBottom: 16 }}>
        <div>{pinToShow}</div>
        <button onClick={() => startProducer()}>Producer</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
        ></input>
        <button onClick={() => startConsumer()}>Consumer</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input type="file" onChange={(e) => onFileChange(e)}></input>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div>SEND</div>
        {sendTasks.map((info) => (
          <FileTransferTask key={info.meta.id} info={info} />
        ))}
      </div>
      <div style={{ marginBottom: 16 }}>
        <div>RECV</div>
        {recvTasks.map((info) => (
          <FileTransferTask key={info.meta.id} info={info} />
        ))}
      </div>
    </div>
  );
}

function FileTransferTask(props: { info: FileTransferInfo }) {
  const { info } = props;
  return (
    <div
      style={{
        padding: 8,
        border: "1px solid #000",
      }}
    >
      <div>
        <span style={{ marginRight: 8 }}>ID: {info.meta.id}</span>
        <span style={{ marginRight: 8 }}>NAME: {info.meta.name}</span>
        <span style={{ marginRight: 8 }}>SIZE: {info.meta.size}</span>
      </div>
      <div>
        <span style={{ marginRight: 8 }}>
          PRCT:
          {((info.progress.receivedSize / info.meta.size) * 100).toFixed(2)}%
        </span>
        <span style={{ marginRight: 8 }}>
          RATE: {info.progress.rate.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export default App;
