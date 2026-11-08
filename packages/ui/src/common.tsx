import { Dialog } from "@base-ui/react/dialog";
import { Cloud, File, FileAudio, FileImage, FileText, FileVideo, Folder, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { Api, Item } from "@r2client/core";
import { objectCategory } from "@r2client/core";
import { locales } from "./languages";

export interface Platform {
  api: Api;
  addFiles(entries: { file: File; relative?: string }[]): Promise<void>;
  attachFile(id: string, file: File): Promise<void>;
  pasteNative?(): Promise<void>;
  copyText?(text: string): Promise<void>;
  capabilities: { desktop: boolean; folders: boolean };
}
export interface Preferences {
  language: "en" | "zh" | "ja" | "ko";
  theme: "system" | "light" | "dark";
  view: "grid" | "list";
  zoom: number;
  concurrency: number;
  replace: boolean;
  shareFormat: "url" | "markdown" | "html" | "bbcode";
  shareServer: string;
  preview: boolean;
  autoRefresh: number;
}
export const defaults: Preferences = {
  language: "en",
  theme: "system",
  view: "grid",
  zoom: 100,
  concurrency: 2,
  replace: false,
  shareFormat: "url",
  shareServer: "",
  preview: true,
  autoRefresh: 0,
};
export type Tr = (english: string, chinese?: string, japanese?: string, korean?: string) => string;
export const translator =
  (lang: Preferences["language"]): Tr =>
  (en, zh, ja, ko) =>
    (lang === "zh"
      ? zh
      : lang === "ja"
        ? (ja ?? locales.get(en)?.ja)
        : lang === "ko"
          ? (ko ?? locales.get(en)?.ko)
          : en) ?? en;
export const tabStrings = (t: Tr) => ({
  files: t("Files", "文件列表", "ファイル", "파일"),
  upload: t("Upload files", "上传文件", "アップロード", "업로드"),
  transfers: t("Transfers", "传输管理", "転送", "전송"),
  statistics: t("Storage statistics", "存储统计", "ストレージ統計", "저장소 통계"),
  extensions: t("Extensions", "扩展功能", "拡張機能", "확장 기능"),
});
export function IconButton({
  label,
  className = "",
  children,
  ...p
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      className={"icon-button " + className}
      title={label}
      aria-label={label}
      {...p}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  open,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className={"dialog " + (wide ? "dialog-wide" : "")}>
          <div className="dialog-title">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="icon-button">
              <X size={17} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Cloud size={37} strokeWidth={1.35} />
      <p>{label}</p>
      {action}
    </div>
  );
}
export function FileIcon({ item, size = 22 }: { item: Pick<Item, "kind" | "key">; size?: number }) {
  const map = {
    image: FileImage,
    video: FileVideo,
    audio: FileAudio,
    pdf: FileText,
    text: FileText,
    file: File,
  };
  const C = item.kind === "folder" ? Folder : map[objectCategory(item.key)];
  return (
    <C
      size={size}
      className={"file-icon " + (item.kind === "folder" ? "folder-icon" : "")}
      strokeWidth={1.6}
    />
  );
}
export function dateLabel(date: string) {
  if (!date) return "—";
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
type Entry = {
  name: string;
  fullPath: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (resolve: (f: File) => void, reject: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (resolve: (e: Entry[]) => void, reject: (e: unknown) => void) => void;
  };
};
export async function droppedFiles(data: DataTransfer) {
  const initial = [...data.items].flatMap((item) => {
    const entry = item.webkitGetAsEntry?.() as unknown as Entry | null;
    return entry ? [entry] : [];
  });
  const fallback = [...data.files].map((file) => ({
    file,
    relative: file.webkitRelativePath || file.name,
  }));
  if (!initial.length) return fallback;
  const result: { file: File; relative?: string }[] = [];
  async function walk(entry: Entry) {
    if (entry.isFile && entry.file) {
      const f = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
      result.push({ file: f, relative: entry.fullPath.replace(/^\//, "") });
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      for (;;) {
        const rows = await new Promise<Entry[]>((res, rej) => reader.readEntries(res, rej));
        if (!rows.length) break;
        for (const row of rows) await walk(row);
      }
    }
  }
  for (const entry of initial) await walk(entry);
  return result.length ? result : fallback;
}
export function splitUrls(input: string) {
  const raw = input
    .trim()
    .split(/[\n\r\t ]+|[,;](?=\s*https?:\/\/)/i)
    .map((x) => x.trim().replace(/[,;]$/, ""))
    .filter(Boolean);
  if (raw.some((x) => !/^https?:\/\//i.test(x)))
    throw new Error("Enter HTTP or HTTPS URLs separated by line breaks");
  return [...new Set(raw)];
}
