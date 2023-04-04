export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = filename;
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(reader.error);
    };
    reader.readAsArrayBuffer(file);
  });
}
