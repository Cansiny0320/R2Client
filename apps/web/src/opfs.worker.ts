interface SyncFile {
  getSize(): number;
  write(b: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type SyncHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncFile> };
interface Task {
  request: number;
  id: string;
  op: "size" | "append" | "reset" | "remove";
  data?: Uint8Array;
}
let pending = Promise.resolve();
self.onmessage = ({ data: task }: MessageEvent<Task>) => {
  pending = pending.then(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("r2client-partial", { create: true });
      let result = 0;
      if (task.op === "remove")
        await dir.removeEntry(task.id).catch((e) => {
          if (e.name !== "NotFoundError") throw e;
        });
      else {
        const file = (await dir.getFileHandle(task.id, { create: true })) as SyncHandle;
        const handle = await file.createSyncAccessHandle();
        try {
          const size = handle.getSize();
          if (task.op === "size") result = size;
          if (task.op === "reset") {
            handle.truncate(0);
            handle.flush();
          }
          if (task.op === "append" && task.data) {
            if (handle.write(task.data, { at: size }) !== task.data.length)
              throw new Error("Partial write to browser storage");
            handle.flush();
          }
        } finally {
          handle.close();
        }
      }
      self.postMessage({ request: task.request, result });
    } catch (e) {
      self.postMessage({
        request: task.request,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
};
