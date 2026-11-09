import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "@r2client/core";

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function localCredentials(directory: string) {
  const fileFor = (id: string) =>
    path.join(directory, createHash("sha256").update(id).digest("hex") + ".json");
  async function checkDirectory() {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.mode & 0o077 || info.uid !== process.getuid?.())
      throw new Error("The local credentials directory must be private to this user");
  }
  return {
    async get(id: string): Promise<Credentials | undefined> {
      try {
        await checkDirectory();
        const file = await open(fileFor(id), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.mode & 0o077 || info.uid !== process.getuid?.())
            throw new Error("The local credentials file must be private to this user");
          const value = JSON.parse(await file.readFile("utf8")) as Partial<Credentials> | null;
          if (
            typeof value?.accessKeyId === "string" &&
            value.accessKeyId &&
            typeof value.secretAccessKey === "string" &&
            value.secretAccessKey &&
            (value.sessionToken === undefined || typeof value.sessionToken === "string")
          )
            return value as Credentials;
          return undefined;
        } finally {
          await file.close();
        }
      } catch (error) {
        if (missing(error)) return undefined;
        throw new Error(
          "Could not read local credentials. Reconnect the bucket to save them again.",
        );
      }
    },
    async set(id: string, value: Credentials | undefined) {
      const file = fileFor(id);
      if (!value) {
        try {
          await checkDirectory();
          await rm(file, { force: true });
        } catch (error) {
          if (!missing(error)) throw error;
        }
        return;
      }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await checkDirectory();
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },
  };
}
