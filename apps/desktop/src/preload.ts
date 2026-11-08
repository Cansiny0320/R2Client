import { contextBridge, ipcRenderer, webUtils } from "electron";
import { remote } from "@r2client/core";
import type { Api, Call } from "@r2client/core";
const invoke = <K extends keyof Api>(call: Call<K>) =>
  ipcRenderer.invoke("r2:invoke", call) as ReturnType<Api[K]>;
function nativeFiles(input: { file: File; relative?: string }[]) {
  return input
    .map(({ file, relative }) => ({ file: webUtils.getPathForFile(file), relative }))
    .filter((x) => x.file);
}
contextBridge.exposeInMainWorld("r2client", {
  api: remote(invoke),
  addFiles: (input: { file: File; relative?: string }[]) =>
    ipcRenderer.invoke("r2:drop", nativeFiles(input)),
  attachFile: (id: string, file: File) =>
    ipcRenderer.invoke("r2:drop", nativeFiles([{ file }]), id),
  pasteNative: () => ipcRenderer.invoke("r2:paste"),
  copyText: (text: string) => ipcRenderer.invoke("r2:clipboard", text),
  capabilities: { folders: true, desktop: true },
});
