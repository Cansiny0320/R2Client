import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowLeft,
  Cloud,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  X,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useRef } from "react";
import type { Api, DownloadCompletion, Item, UploadTuning } from "@r2client/core";
import { DEFAULT_UPLOAD, objectCategory } from "@r2client/core";
import { locales } from "./languages";
import { mediaDefaults } from "./media-settings";
import type { MediaDefaults } from "./media-settings";

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
  uploadTuning: UploadTuning;
  media: MediaDefaults;
  replace: boolean;
  shareFormat: "url" | "markdown" | "html" | "bbcode";
  shareServer: string;
  preview: boolean;
  autoRefresh: number;
  downloadFolder: string;
  downloadCompletion: DownloadCompletion;
  downloadParallel: number;
  pageSize: 25 | 50 | 100 | 200;
}
export const defaults: Preferences = {
  language: "en",
  theme: "system",
  view: "grid",
  zoom: 100,
  uploadTuning: { ...DEFAULT_UPLOAD },
  media: mediaDefaults,
  replace: false,
  shareFormat: "url",
  shareServer: "",
  preview: true,
  autoRefresh: 0,
  downloadFolder: "",
  downloadCompletion: "notify",
  downloadParallel: 2,
  pageSize: 100,
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
  backLabel,
  pageHeading,
  pageActions,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  backLabel?: string;
  pageHeading?: ReactNode;
  pageActions?: ReactNode;
}) {
  const backButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup
          className={"dialog " + (backLabel ? "dialog-page" : wide ? "dialog-wide" : "")}
          initialFocus={backLabel ? backButton : undefined}
        >
          {backLabel ? (
            <header className="dialog-page-title">
              <Dialog.Close ref={backButton} aria-label={backLabel} className="button">
                <ArrowLeft size={15} /> {backLabel}
              </Dialog.Close>
              {pageHeading ? (
                <div className="dialog-page-heading">
                  <Dialog.Title>{title}</Dialog.Title>
                  {pageHeading}
                </div>
              ) : (
                <Dialog.Title className="sr-only">{title}</Dialog.Title>
              )}
              {pageActions}
            </header>
          ) : (
            <div className="dialog-title">
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close aria-label="Close" className="icon-button">
                <X size={17} />
              </Dialog.Close>
            </div>
          )}
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
    : d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
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
