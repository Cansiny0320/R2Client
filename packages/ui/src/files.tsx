import {
  ArrowDownToLine,
  ArrowUpToLine,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  Link2,
  List,
  Minus,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { byteLabel, formatLink, joined, nameOf, objectCategory, renamePlan } from "@r2client/core";
import type { Detail, Index, Item, Mutation, Outcome, Profile, RenameRule } from "@r2client/core";
import { connectionFailure, dateLabel, Empty, FileIcon, IconButton, Modal } from "./common";
import type { Platform, Preferences, Tr } from "./common";
import { copyText, ShareDialog } from "./sharing";

type Fn = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
const emptyDirectory: Item[] = [];
const dimensions = ["name", "newest", "oldest", "size"] as const;
type Sort = (typeof dimensions)[number];
const danger = (kind: string) => kind === "delete" || kind === "move" || kind === "rename";
type Action = "copy" | "move" | "delete" | "rename" | "metadata" | "folder";
const buttons = {
  copy: Copy,
  move: FolderInput,
  delete: Trash2,
  rename: Pencil,
  metadata: Settings2,
  folder: FolderPlus,
};
const labels = (t: Tr): Record<Action, string> => ({
  copy: t("Copy", "复制"),
  move: t("Move", "移动"),
  delete: t("Delete", "删除"),
  rename: t("Rename", "重命名"),
  metadata: t("Metadata", "元数据"),
  folder: t("New folder", "新建文件夹"),
});
const thumbnailQueue = new Set<() => Promise<void>>();
let activeThumbnails = 0;
function pumpThumbnails() {
  for (const start of thumbnailQueue) {
    if (activeThumbnails >= 4) break;
    thumbnailQueue.delete(start);
    activeThumbnails++;
    void start().finally(() => {
      activeThumbnails--;
      pumpThumbnails();
    });
  }
}
function Thumb({
  p,
  profile,
  item,
  prefs,
  t,
}: {
  p: Platform;
  profile: Profile;
  item: Item;
  prefs: Preferences;
  t: Tr;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const finish = useRef<() => void>(undefined);
  const [src, setSrc] = useState("");
  const isImage = item.kind === "object" && objectCategory(item.key) === "image" && prefs.preview;
  useEffect(() => {
    const element = ref.current;
    if (!isImage || !element) return;
    let current = true;
    const start = () =>
      new Promise<void>((resolve) => {
        observer.disconnect();
        const settle = () => {
          clearTimeout(timer);
          if (finish.current === settle) finish.current = undefined;
          resolve();
        };
        const timer = setTimeout(() => {
          setSrc("");
          settle();
        }, 30_000);
        finish.current = settle;
        void Promise.resolve()
          .then(() => p.api.links(profile.id, item.key, 300, "preview"))
          .then((url) => {
            if (current && finish.current === settle && url) setSrc(url);
            else settle();
          }, settle);
      });
    const observer = new IntersectionObserver(
      (entries) => {
        if (!current) return;
        if (entries.at(-1)?.isIntersecting) {
          thumbnailQueue.add(start);
          pumpThumbnails();
        } else thumbnailQueue.delete(start);
      },
      { rootMargin: "60px" },
    );
    observer.observe(element);
    return () => {
      current = false;
      observer.disconnect();
      thumbnailQueue.delete(start);
      finish.current?.();
    };
  }, [profile.id, item.key, isImage, p]);
  return (
    <div ref={ref} className={"thumbnail " + (item.kind === "folder" ? "thumbnail-folder" : "")}>
      {isImage && src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => finish.current?.()}
          onError={() => {
            setSrc("");
            finish.current?.();
          }}
        />
      ) : (
        <div className="thumb-placeholder">
          <FileIcon item={item} size={41} />
          {item.kind === "folder" && (
            <small>{t("Open folder", "打开文件夹", "フォルダを開く", "폴더 열기")}</small>
          )}
        </div>
      )}
    </div>
  );
}
function Preview({
  p,
  profile,
  item,
  t,
  close,
  onShare,
  onCopy,
  onView,
  onDownload,
  onDownloadTo,
  onRename,
  onDelete,
  onNavigate,
}: {
  p: Platform;
  profile: Profile;
  item: Item;
  t: Tr;
  close: () => void;
  onShare: () => void;
  onCopy: () => void;
  onView: () => void;
  onDownload: () => void;
  onDownloadTo?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNavigate?: (step: -1 | 1) => void;
}) {
  useLayoutEffect(() => {
    if (!onNavigate) return;
    const keydown = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input, textarea, select, video, audio, [contenteditable=true]"))
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        onNavigate(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [onNavigate]);
  const toolbar = [
    [ArrowDownToLine, t("Download", "下载"), onDownload],
    [FolderOpen, t("Save as…", "另存为…"), onDownloadTo],
    [Link2, t("Copy link", "复制链接"), onCopy],
    [QrCode, t("Share and QR code", "分享与二维码"), onShare],
    [ArrowUpRight, t("View in browser", "在浏览器中查看"), onView],
    [Pencil, labels(t).rename, onRename],
    [Trash2, labels(t).delete, onDelete],
  ] as const;
  return (
    <Modal
      title={nameOf(item.key)}
      open
      onClose={close}
      backLabel={t("Back", "返回")}
      pageHeading={
        <span>
          {byteLabel(item.size)} · {dateLabel(item.modified)}
        </span>
      }
      pageActions={
        <div className="preview-actions">
          {toolbar.map(
            ([Icon, label, action]) =>
              action && (
                <IconButton key={label} label={label} onClick={action}>
                  <Icon size={17} />
                </IconButton>
              ),
          )}
        </div>
      }
    >
      <div className="preview-gallery">
        {onNavigate && (
          <IconButton
            className="preview-previous"
            label={t("Previous file", "上一个文件")}
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeft size={26} />
          </IconButton>
        )}
        <PreviewContent key={item.key} p={p} profile={profile} item={item} t={t} />
        {onNavigate && (
          <IconButton
            className="preview-next"
            label={t("Next file", "下一个文件")}
            onClick={() => onNavigate(1)}
          >
            <ChevronRight size={26} />
          </IconButton>
        )}
      </div>
    </Modal>
  );
}

function PreviewContent({
  p,
  profile,
  item,
  t,
}: {
  p: Platform;
  profile: Profile;
  item: Item;
  t: Tr;
}) {
  const [detail, setDetail] = useState<Detail>(),
    [url, setUrl] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [zoom, setZoom] = useState(100);
  const category = objectCategory(item.key);
  useEffect(() => {
    let active = true;
    let localUrl = "";
    void (async () => {
      const d = await p.api.detail(profile.id, item.key);
      if (!active) return;
      setDetail(d);
      if (category === "text" || category === "pdf") {
        const bytes = await p.api.previewDocument(profile.id, item.key, category);
        if (!active) return;
        if (category === "text") setText(new TextDecoder().decode(bytes));
        else {
          localUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
          );
          setUrl(localUrl);
        }
      } else if (category === "image" || category === "video" || category === "audio") {
        const u = await p.api.links(profile.id, item.key, 300, "preview");
        if (active) setUrl(u);
      }
    })()
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [p, profile.id, item.key, category]);
  return (
    <div className="preview-content">
      <div className="media-preview">
        {url && category === "image" ? (
          <div className="image-preview">
            <div className="row gap image-zoom">
              <IconButton
                label={t("Zoom out", "缩小")}
                disabled={zoom === 25}
                onClick={() => setZoom(zoom - 25)}
              >
                <Minus size={16} />
              </IconButton>
              <button
                className="button"
                aria-label={t("Reset zoom", "重置缩放")}
                onClick={() => setZoom(100)}
              >
                {zoom}%
              </button>
              <IconButton
                label={t("Zoom in", "放大")}
                disabled={zoom === 300}
                onClick={() => setZoom(zoom + 25)}
              >
                <Plus size={16} />
              </IconButton>
            </div>
            <div className="image-preview-scroll">
              <img
                src={url}
                alt={nameOf(item.key)}
                style={{ width: zoom + "%", height: zoom + "%" }}
                onError={() => setError(t("Could not load this image", "无法加载此图片"))}
              />
            </div>
          </div>
        ) : url && category === "video" ? (
          <video src={url} controls preload="metadata" />
        ) : url && category === "audio" ? (
          <audio src={url} controls preload="metadata" />
        ) : url && category === "pdf" ? (
          <iframe src={url} title={nameOf(item.key)} />
        ) : category === "text" && !loading && !error ? (
          <pre>{text}</pre>
        ) : loading ? (
          <span role="status">{t("Loading preview…", "正在加载预览…")}</span>
        ) : (
          <FileIcon item={item} size={45} />
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <details className="preview-details">
        <summary>{t("File information", "文件信息")}</summary>
        <dl className="detail-grid">
          <dt>{t("Object key", "对象路径")}</dt>
          <dd>{item.key}</dd>
          <dt>{t("Size", "大小")}</dt>
          <dd>{byteLabel(detail?.size ?? item.size)}</dd>
          <dt>{t("Last modified", "最后更新")}</dt>
          <dd>{dateLabel(detail?.modified ?? item.modified)}</dd>
          <dt>Content-Type</dt>
          <dd>{detail?.type ?? "—"}</dd>
          <dt>ETag</dt>
          <dd>{detail?.etag ?? "—"}</dd>
          {Object.entries(detail?.metadata ?? {})
            .filter(([k]) => k !== "r2client-job")
            .map(([k, v]) => (
              <div className="detail-row" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </details>
    </div>
  );
}
function ActionModal({
  action,
  items,
  prefix,
  t,
  close,
  onExecute,
}: {
  action: Action;
  items: Item[];
  prefix: string;
  t: Tr;
  close: () => void;
  onExecute: (actions: Mutation[]) => Promise<Outcome[] | undefined>;
}) {
  const [value, setValue] = useState(
    action === "rename" && items.length === 1 ? nameOf(items[0]!.key) : "",
  );
  const [replacement, setReplacement] = useState(""),
    [mode, setMode] = useState<RenameRule["mode"]>(items.length === 1 ? "name" : "prefix");
  const [meta, setMeta] = useState(""),
    [cache, setCache] = useState(""),
    [type, setType] = useState(""),
    [disposition, setDisposition] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function build(): Mutation[] {
    if (action === "folder") return [{ kind: "folder", key: joined(prefix, value.trim()) }];
    if (action === "rename") return renamePlan(items, { mode, text: value, replacement });
    if (action === "delete")
      return items.map((x) => ({ kind: "delete", key: x.key, expectedEtag: x.etag }));
    if (action === "metadata") {
      const metadata: Record<string, string> = {};
      for (const l of meta
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const i = l.indexOf("="),
          k = l.slice(0, i).trim().toLowerCase();
        if (i < 1 || !/^[a-z0-9][a-z0-9-]*$/.test(k) || k.startsWith("r2client-"))
          throw new Error("Use valid metadata in key=value format");
        metadata[k] = l.slice(i + 1).trim();
      }
      return items.map((x) => ({
        kind: "metadata",
        key: x.key,
        metadata,
        type: type || undefined,
        cacheControl: cache || undefined,
        disposition: disposition || undefined,
        expectedEtag: x.etag,
      }));
    }
    const dest = value.replace(/^\/+|\/+$/g, "");
    return items.map((x) => ({
      kind: action,
      key: x.key,
      expectedEtag: x.etag,
      target: joined(dest ? dest + "/" : "", nameOf(x.key) + (x.kind === "folder" ? "/" : "")),
    }));
  }
  const proposed = useMemo(() => {
    try {
      return action === "rename" || action === "move" || action === "copy" ? build() : [];
    } catch {
      return [];
    }
    // Inputs are the only mutable values used in the preview.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [action, items, value, mode, replacement]);
  async function execute(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const list = build();
      if (!list.length) throw new Error("No changes to apply");
      const r = await onExecute(list);
      if (r) setOutcomes(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={labels(t)[action]} open onClose={close}>
      {outcomes ? (
        <div className="dialog-body stack">
          <div className="notice">
            {outcomes.filter((x) => x.ok).length} {t("succeeded", "成功")} ·{" "}
            {outcomes.filter((x) => !x.ok).length} {t("failed", "失败")}
          </div>
          <div className="result-list">
            {outcomes.map((x, i) => (
              <div key={i} className={x.ok ? "" : "danger-text"}>
                <b>{x.ok ? "✓" : "×"}</b> {x.key}
                {x.target ? " → " + x.target : ""}
                {x.error && <small>{x.error}</small>}
              </div>
            ))}
          </div>
          <button className="button" onClick={close}>
            {t("Done", "完成")}
          </button>
        </div>
      ) : (
        <form className="dialog-body stack" onSubmit={execute}>
          {action !== "folder" && (
            <div className="subtle">
              {items.length} {t("selected", "项已选")}
            </div>
          )}
          {action === "folder" && (
            <label>
              {t("Folder name", "文件夹名称")}
              <input required value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          {["copy", "move"].includes(action) && (
            <label>
              {t("Destination folder", "目标目录")}
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("Empty means bucket root", "留空表示存储桶根目录")}
              />
            </label>
          )}
          {action === "rename" && (
            <>
              <label>
                {t("Rule", "规则")}
                <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  {items.length === 1 && <option value="name">{t("New name", "新名称")}</option>}
                  <option value="prefix">{t("Prefix", "前缀")}</option>
                  <option value="suffix">{t("Suffix", "后缀")}</option>
                  <option value="replace">{t("Replace", "替换")}</option>
                  <option value="regex">{t("Regular expression", "正则表达式")}</option>
                  <option value="number">{t("Sequence", "编号")}</option>
                </select>
              </label>
              <label>
                {t("Name or pattern", "名称或匹配模式")}
                <input value={value} onChange={(e) => setValue(e.target.value)} />
              </label>
              {["replace", "regex"].includes(mode) && (
                <label>
                  {t("Replacement", "替换为")}
                  <input value={replacement} onChange={(e) => setReplacement(e.target.value)} />
                </label>
              )}
            </>
          )}
          {action === "metadata" && (
            <>
              <label>
                Content-Type
                <input value={type} onChange={(e) => setType(e.target.value)} />
              </label>
              <label>
                Cache-Control
                <input value={cache} onChange={(e) => setCache(e.target.value)} />
              </label>
              <label>
                Content-Disposition
                <input value={disposition} onChange={(e) => setDisposition(e.target.value)} />
              </label>
              <label>
                {t("Custom metadata (key=value per line)", "自定义元数据（每行 key=value）")}
                <textarea value={meta} onChange={(e) => setMeta(e.target.value)} />
              </label>
            </>
          )}
          {action === "delete" && (
            <div className="notice error">
              {t(
                "This permanently deletes the selected objects. Folders include everything below them.",
                "永久删除所选对象。选择文件夹时包含其下的所有对象。",
              )}
            </div>
          )}
          {!!proposed.length && (
            <div className="result-list">
              {proposed.slice(0, 12).map((x) => (
                <div key={x.key}>
                  {x.key} → {x.target}
                </div>
              ))}
              {proposed.length > 12 && <div>+ {proposed.length - 12}</div>}
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div className="row end gap">
            <button type="button" className="button" onClick={close}>
              {t("Cancel", "取消")}
            </button>
            <button
              className={"button " + (danger(action) && action === "delete" ? "danger" : "primary")}
              disabled={busy}
            >
              {busy ? t("Working…", "处理中…") : labels(t)[action]}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
export function Files({
  platform: p,
  profile,
  prefix,
  go,
  connected,
  prefs,
  setPrefs,
  t,
  run,
  notify,
  upload,
  connect,
  index,
  setIndex,
}: {
  platform: Platform;
  profile: Profile;
  prefix: string;
  go: (s: string) => void;
  connected: boolean;
  prefs: Preferences;
  setPrefs: (v: Partial<Preferences>) => void;
  t: Tr;
  run: Fn;
  notify: (s: string) => void;
  upload: () => void;
  connect: () => void;
  index?: Index;
  setIndex: (v: Index) => void;
}) {
  const [directory, setDirectory] = useState<{ prefix: string; items: Item[] }>(),
    [local, setLocal] = useState(0);
  const [version, refresh] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [draft, setDraft] = useState({ query: "", category: "", sort: "newest" as Sort }),
    [sort, setSort] = useState<Sort>("newest"),
    [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Map<string, Item>>(new Map()),
    [preview, setPreview] = useState<Item>(),
    [share, setShare] = useState<{ item: Item; previewLink?: string }>(),
    [action, setAction] = useState<Action>();
  const [menu, setMenu] = useState<string>(),
    [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState("");
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".file-actions"))
        setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(undefined);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    setLocal(0);
    setSelected(new Map());
    setQuery("");
    setMenu(undefined);
    setSearchOpen(false);
  }, [profile.id, prefix, prefs.pageSize]);
  useEffect(() => {
    if (!connected) return;
    let valid = true;
    setLoading(true);
    setError("");
    async function loadDirectory() {
      const items = new Map<string, Item>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await p.api.list(profile.id, prefix, cursor);
        if (!valid) return;
        for (const item of page.items) items.set(item.key, item);
        cursor = page.next;
        if (cursor) {
          if (cursors.has(cursor)) throw new Error("The R2 cursor stopped advancing");
          cursors.add(cursor);
        }
      } while (cursor);
      setDirectory({ prefix, items: [...items.values()] });
    }
    void loadDirectory()
      .catch((e) => {
        if (valid) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [p, profile.id, prefix, connected, version]);
  useEffect(() => {
    if (!connected || !prefs.autoRefresh) return;
    const timer = setInterval(() => refresh((x) => x + 1), prefs.autoRefresh * 60_000);
    return () => clearInterval(timer);
  }, [connected, prefs.autoRefresh]);
  const source =
    query && index
      ? index.objects
      : directory?.prefix === prefix
        ? directory.items
        : emptyDirectory;
  const isIndexedSearch = !!(query && index);
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = new Map<string, Item>();
    for (const item of source) {
      if (
        !isIndexedSearch ||
        (q.includes("/") ? item.key : nameOf(item.key)).toLowerCase().includes(q)
      ) {
        matches.set(item.key, item);
      }
      if (!isIndexedSearch || q.includes("/") || item.kind !== "object") continue;
      const parts = item.key.split("/").slice(0, -1);
      let folder = "";
      for (const part of parts) {
        folder += part + "/";
        if (
          part.toLowerCase().includes(q) &&
          (matches.get(folder)?.modified ?? "") <= item.modified
        ) {
          matches.set(folder, { key: folder, kind: "folder", modified: item.modified, size: 0 });
        }
      }
    }
    return [...matches.values()]
      .filter(
        (x) =>
          (isIndexedSearch || !q || x.key.toLowerCase().includes(q)) &&
          (!category || x.kind === "folder" || objectCategory(x.key) === category),
      )
      .sort((a, b) => {
        if (!isIndexedSearch && a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        if (sort === "size") return b.size - a.size;
        if (sort === "name") return a.key.localeCompare(b.key);
        return sort === "newest"
          ? b.modified.localeCompare(a.modified)
          : a.modified.localeCompare(b.modified);
      });
  }, [source, query, category, sort, isIndexedSearch]);
  const localMax = Math.max(1, Math.ceil(sorted.length / prefs.pageSize)),
    currentPage = Math.min(local, localMax - 1),
    shown = sorted.slice(currentPage * prefs.pageSize, (currentPage + 1) * prefs.pageSize);
  const all = shown.length > 0 && shown.every((x) => selected.has(x.key));
  const choose = (item: Item) =>
    setSelected((old) => {
      const n = new Map(old);
      if (n.has(item.key)) n.delete(item.key);
      else n.set(item.key, item);
      return n;
    });
  const selectAll = () =>
    setSelected((old) => {
      const n = new Map(old);
      for (const x of shown)
        if (all) n.delete(x.key);
        else n.set(x.key, x);
      return n;
    });
  async function sync() {
    setSyncing(true);
    setSyncError("");
    try {
      setIndex(await p.api.scan(profile.id));
      refresh((x) => x + 1);
    } catch (e) {
      setSyncError(connectionFailure(e, t).message);
    } finally {
      setSyncing(false);
    }
  }
  async function download(items: Item[], chooseFolder = false) {
    if (!items.length) return;
    await run(async () => {
      const options = { completion: prefs.downloadCompletion, parallel: prefs.downloadParallel };
      const file = items.length === 1 && items[0]?.kind === "object" ? items[0] : undefined;
      if (chooseFolder && file) {
        if (await p.api.downloadAs(profile.id, file, prefs.replace, options)) {
          notify(t("Added to transfers", "已加入传输队列"));
        }
        return;
      }
      const folder = chooseFolder ? await p.api.pickDestination() : prefs.downloadFolder;
      if (chooseFolder && !folder) return;
      await p.api.download(profile.id, items, folder ?? "", prefix, prefs.replace, options);
      notify(t("Added to transfers", "已加入传输队列"));
    });
  }
  const chosen = [...selected.values()];
  const previewItems = preview ? sorted.filter((item) => item.kind === "object") : [];
  const previewIndex = preview ? previewItems.findIndex((item) => item.key === preview.key) : -1;
  const previewLink = (item: Item) =>
    p.api.links(profile.id, item.key, 3600, profile.publicBase ? "public" : "signed");
  const copyObjectLink = (item: Item) =>
    run(
      async () =>
        copyText(p, formatLink(await previewLink(item), nameOf(item.key), prefs.shareFormat)),
      t("Copied", "已复制"),
    );
  function singleAction(item: Item, action: "rename" | "delete") {
    setPreview(undefined);
    setMenu(undefined);
    setSelected(new Map([[item.key, item]]));
    setAction(action);
  }
  const crumbs = prefix.split("/").filter(Boolean);
  const searchActive = !!query || !!category || sort !== "newest";
  function applySearch(value: typeof draft) {
    setQuery(value.query.trim());
    setCategory(value.category);
    setSort(value.sort);
    setLocal(0);
    setSelected(new Map());
    setSearchOpen(false);
  }
  return (
    <section
      className="files-section"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "a" && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          selectAll();
        }
      }}
    >
      <div className="file-toolbar">
        <nav className="breadcrumbs" aria-label={t("Folder path", "文件夹路径")}>
          <button
            className="crumb"
            aria-current={!prefix ? "location" : undefined}
            onClick={() => go("")}
          >
            {t("All files", "所有文件", "すべてのファイル", "모든 파일")}
          </button>
          {crumbs.map((name, i) => (
            <span key={i}>
              <ChevronRight size={13} />
              <button
                className="crumb"
                aria-current={i === crumbs.length - 1 ? "location" : undefined}
                onClick={() => go(crumbs.slice(0, i + 1).join("/") + "/")}
              >
                {name}
              </button>
            </span>
          ))}
        </nav>
        <div className="toolbar-actions">
          <button
            className={"button " + (searchActive ? "selected" : "")}
            aria-haspopup="dialog"
            onClick={() => {
              setDraft({ query, category, sort });
              setSearchOpen(true);
            }}
          >
            <Search size={15} /> {t("Search", "搜索", "検索", "검색")}
          </button>
          <button className="button primary" onClick={upload} disabled={!connected}>
            <ArrowUpToLine size={15} /> {t("Upload", "上传", "アップロード", "업로드")}
          </button>
          <div className="segmented">
            <button
              type="button"
              className={"button view-option " + (prefs.view === "grid" ? "active" : "")}
              aria-label={t("Grid", "网格", "グリッド", "격자")}
              aria-pressed={prefs.view === "grid"}
              onClick={() => setPrefs({ view: "grid" })}
            >
              <Grid2X2 size={15} />
              <span className="toolbar-label">{t("Grid", "网格", "グリッド", "격자")}</span>
            </button>
            <button
              type="button"
              className={"button view-option " + (prefs.view === "list" ? "active" : "")}
              aria-label={t("List", "列表", "一覧", "목록")}
              aria-pressed={prefs.view === "list"}
              onClick={() => setPrefs({ view: "list" })}
            >
              <List size={17} />
              <span className="toolbar-label">{t("List", "列表", "一覧", "목록")}</span>
            </button>
          </div>
          <button
            type="button"
            className="button"
            aria-label={t("Refresh", "刷新")}
            disabled={!connected || loading}
            onClick={() => refresh((x) => x + 1)}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            <span className="toolbar-label">{t("Refresh", "刷新")}</span>
          </button>
          <button
            type="button"
            className={"button " + (all ? "selected" : "")}
            aria-label={t("Select all", "全选", "全選択", "전체 선택")}
            aria-pressed={all}
            disabled={!shown.length}
            onClick={selectAll}
          >
            <Check size={15} />
            <span className="toolbar-label">{t("Select all", "全选", "全選択", "전체 선택")}</span>
          </button>
          <IconButton
            label={labels(t).folder}
            disabled={!connected}
            onClick={() => setAction("folder")}
          >
            <FolderPlus size={17} />
          </IconButton>
        </div>
      </div>
      {query && (
        <div className="searchbar">
          <span>
            {t("Search results:", "搜索结果：")} <strong>{query}</strong>
          </span>
          <IconButton
            label={t("Clear search", "清除搜索")}
            onClick={() => applySearch({ ...draft, query: "", category, sort })}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
      {searchOpen && (
        <Modal open title={t("Search files", "搜索文件")} onClose={() => setSearchOpen(false)}>
          <form
            className="dialog-body stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const term = draft.query.trim();
              if (term && !index && connected) await sync();
              applySearch(draft);
            }}
          >
            <input
              autoFocus
              aria-label={t("Search objects", "搜索对象")}
              placeholder={t("Enter a filename to search…", "输入文件名进行搜索…")}
              value={draft.query}
              onChange={(event) => setDraft({ ...draft, query: event.target.value })}
            />
            <div className="search-options">
              <select
                aria-label={t("Filter files", "筛选文件")}
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                <option value="">{t("All types", "所有类型")}</option>
                {["image", "video", "audio", "pdf", "text", "file"].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("Sort files", "文件排序")}
                value={draft.sort}
                onChange={(e) => setDraft({ ...draft, sort: e.target.value as Sort })}
              >
                <option value="newest">{t("Newest first", "最新优先")}</option>
                <option value="oldest">{t("Oldest first", "最早优先")}</option>
                <option value="name">{t("Name", "名称")}</option>
                <option value="size">{t("Largest first", "最大优先")}</option>
              </select>
            </div>
            <div className="row end gap">
              {searchActive && (
                <button
                  type="button"
                  className="button"
                  onClick={() => applySearch({ query: "", category: "", sort: "newest" })}
                >
                  {t("Clear search", "清除搜索")}
                </button>
              )}
              <button type="submit" className="button primary" disabled={syncing}>
                <Search size={15} /> {t("Search", "搜索")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {chosen.length > 0 && (
        <div className="file-subbar">
          <div className="batch-bar">
            <b>
              {chosen.length} {t("selected", "项已选")}
            </b>
            <IconButton label={t("Download", "下载")} onClick={() => void download(chosen)}>
              <ArrowDownToLine size={15} />
            </IconButton>
            {(["copy", "move", "rename", "metadata", "delete"] as const)
              .filter((a) => a !== "metadata" || chosen.every((x) => x.kind === "object"))
              .map((a) => {
                const Icon = buttons[a];
                return (
                  <IconButton key={a} label={labels(t)[a]} onClick={() => setAction(a)}>
                    <Icon size={15} />
                  </IconButton>
                );
              })}
            <IconButton
              label={t("Clear selection", "清除选择")}
              onClick={() => setSelected(new Map())}
            >
              <X size={15} />
            </IconButton>
          </div>
        </div>
      )}
      <div className="file-scroll">
        {!connected ? (
          <Empty
            label={t("Connect this bucket to view its files", "连接存储桶后即可浏览文件")}
            action={
              <button className="button primary" onClick={connect}>
                {t("Connect", "连接")}
              </button>
            }
          />
        ) : error ? (
          <Empty
            label={error}
            action={
              <button className="button" onClick={() => refresh((x) => x + 1)}>
                {t("Retry", "重试")}
              </button>
            }
          />
        ) : !shown.length ? (
          <Empty label={loading ? t("Loading…", "正在加载…") : t("No files found", "未找到文件")} />
        ) : (
          <div className={prefs.view === "grid" ? "file-grid" : "file-list"}>
            {prefs.view === "list" && (
              <div className="list-head">
                <span />
                {t("File name", "文件名")}
                <span>{t("Size", "大小")}</span>
                <span className="list-action-heading">{t("Actions", "操作")}</span>
              </div>
            )}
            {shown.map((item) => {
              const active = selected.has(item.key);
              const open = () => (item.kind === "folder" ? go(item.key) : setPreview(item));
              return (
                <article
                  className={"file-card " + (active ? "checked" : "")}
                  key={item.key}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu(menu === item.key ? undefined : item.key);
                  }}
                >
                  <input
                    className="file-check"
                    aria-label={t("Select", "选择") + " " + nameOf(item.key)}
                    type="checkbox"
                    checked={active}
                    onChange={() => choose(item)}
                  />
                  {prefs.view === "grid" ? (
                    <button
                      className="thumb-button"
                      onClick={open}
                      aria-label={
                        (item.kind === "folder"
                          ? t("Open folder", "打开文件夹")
                          : t("Preview", "预览")) +
                        " " +
                        nameOf(item.key)
                      }
                    >
                      <Thumb
                        key={String(prefs.preview) + (item.etag ?? item.modified)}
                        p={p}
                        profile={profile}
                        item={item}
                        prefs={prefs}
                        t={t}
                      />
                    </button>
                  ) : null}
                  <button
                    className="file-name"
                    onClick={(e) => (e.ctrlKey || e.metaKey ? choose(item) : open())}
                    title={item.key}
                  >
                    {prefs.view === "list" && <FileIcon item={item} size={18} />}
                    <span>
                      <span>
                        {isIndexedSearch && item.kind === "object" ? item.key : nameOf(item.key)}
                      </span>
                      {prefs.view === "list" && item.modified && (
                        <small className="list-date">{dateLabel(item.modified)}</small>
                      )}
                    </span>
                  </button>
                  {prefs.view === "grid" ? (
                    <div className="file-data">
                      <span>{dateLabel(item.modified)}</span>
                      <span>{item.kind === "object" ? byteLabel(item.size) : ""}</span>
                    </div>
                  ) : (
                    <span className="muted">
                      {item.kind === "object" ? byteLabel(item.size) : "—"}
                    </span>
                  )}
                  <div className="file-actions">
                    {item.kind === "object" && (
                      <>
                        <IconButton
                          label={t("Download", "下载") + " " + nameOf(item.key)}
                          onClick={() => void download([item])}
                        >
                          <ArrowDownToLine size={15} />
                        </IconButton>
                        <IconButton
                          className="wide-card-action"
                          label={t("Copy link", "复制链接") + " " + nameOf(item.key)}
                          onClick={() => void copyObjectLink(item)}
                        >
                          <Link2 size={15} />
                        </IconButton>
                        <IconButton
                          className="wide-card-action"
                          label={labels(t).rename + " " + nameOf(item.key)}
                          onClick={() => singleAction(item, "rename")}
                        >
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton
                          className="wide-card-action"
                          label={labels(t).delete + " " + nameOf(item.key)}
                          onClick={() => singleAction(item, "delete")}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </>
                    )}
                    <IconButton
                      label={t("More actions", "更多操作") + " " + nameOf(item.key)}
                      aria-expanded={menu === item.key}
                      onClick={() => setMenu(menu === item.key ? undefined : item.key)}
                    >
                      <Ellipsis size={17} />
                    </IconButton>
                    {menu === item.key && (
                      <div className="item-menu">
                        {item.kind === "object" && (
                          <button
                            className="compact-card-action"
                            onClick={() => {
                              setMenu(undefined);
                              void copyObjectLink(item);
                            }}
                          >
                            <Link2 size={15} /> {t("Copy link", "复制链接")}
                          </button>
                        )}
                        {item.kind === "object" && (
                          <button
                            onClick={() => {
                              setMenu(undefined);
                              setShare({ item });
                            }}
                          >
                            <QrCode size={15} /> {t("Share", "分享")}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setMenu(undefined);
                            void download([item]);
                          }}
                        >
                          <ArrowDownToLine size={15} />
                          {t("Download", "下载")}
                        </button>
                        {p.capabilities.folders && (
                          <button
                            onClick={() => {
                              setMenu(undefined);
                              void download([item], true);
                            }}
                          >
                            <FolderOpen size={15} />{" "}
                            {item.kind === "object"
                              ? t("Save as…", "另存为…")
                              : t("Download to…", "下载到…")}
                          </button>
                        )}
                        {(["copy", "move", "rename", "metadata", "delete"] as const)
                          .filter((a) => a !== "metadata" || item.kind === "object")
                          .map((a) => {
                            const Icon = buttons[a];
                            return (
                              <button
                                key={a}
                                onClick={() => {
                                  setSelected(new Map([[item.key, item]]));
                                  setAction(a);
                                  setMenu(undefined);
                                }}
                              >
                                <Icon size={15} />
                                {labels(t)[a]}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      {syncError && (
        <div className="notice error file-sync-error row gap" role="alert">
          <span>
            {t("Sync failed.", "同步失败。")} {syncError}
          </span>
          <button className="button" onClick={() => void sync()}>
            {t("Retry sync", "重试同步")}
          </button>
        </div>
      )}
      <footer className="status-bar">
        <div className="row gap">
          <span className={"status-dot " + (error ? "status-error" : "")} />
          <span>
            {index
              ? t("Last synced", "上次同步") + ": " + dateLabel(index.updated)
              : t("Ready", "就绪")}
          </span>
          <button
            className="button ghost"
            disabled={!connected || syncing}
            onClick={() => void sync()}
          >
            <RefreshCw size={13} className={syncing ? "spin" : ""} />{" "}
            {t("Sync bucket", "同步存储桶")}
          </button>
        </div>
        <div className="row gap">
          <button
            className="button pager-button"
            type="button"
            aria-label={t("Previous page", "上一页")}
            disabled={currentPage === 0}
            onClick={() => setLocal(currentPage - 1)}
          >
            <ChevronLeft size={14} />
            <span className="pager-label">{t("Previous page", "上一页")}</span>
          </button>
          <span>
            {t("Page", "页")} {currentPage + 1} / {localMax} · {sorted.length} {t("items", "项")}
          </span>
          <button
            className="button pager-button"
            type="button"
            aria-label={t("Next page", "下一页")}
            disabled={currentPage + 1 >= localMax}
            onClick={() => setLocal(currentPage + 1)}
          >
            <span className="pager-label">{t("Next page", "下一页")}</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </footer>
      {preview && (
        <Preview
          p={p}
          profile={profile}
          item={preview}
          t={t}
          close={() => setPreview(undefined)}
          onShare={() =>
            void run(async () => {
              const link = await previewLink(preview);
              setShare({ item: preview, previewLink: link });
              setPreview(undefined);
            })
          }
          onCopy={() => void copyObjectLink(preview)}
          onView={() => void run(async () => p.api.openExternal(await previewLink(preview)))}
          onDownload={() => void download([preview])}
          onDownloadTo={p.capabilities.folders ? () => void download([preview], true) : undefined}
          onRename={() => singleAction(preview, "rename")}
          onDelete={() => singleAction(preview, "delete")}
          onNavigate={
            previewIndex >= 0 && previewItems.length > 1
              ? (step) =>
                  setPreview(
                    previewItems[(previewIndex + step + previewItems.length) % previewItems.length],
                  )
              : undefined
          }
        />
      )}
      {share && (
        <ShareDialog
          platform={p}
          profile={profile}
          item={share.item}
          initialLink={share.previewLink}
          prefs={prefs}
          t={t}
          close={() => {
            if (share.previewLink) setPreview(share.item);
            setShare(undefined);
          }}
          notify={notify}
        />
      )}
      {action && (
        <ActionModal
          action={action}
          items={chosen}
          prefix={prefix}
          t={t}
          close={() => setAction(undefined)}
          onExecute={async (actions) => {
            const results = await run(() => p.api.mutate(profile.id, actions));
            if (results) {
              refresh((x) => x + 1);
              setSelected(new Map());
            }
            return results;
          }}
        />
      )}
    </section>
  );
}
