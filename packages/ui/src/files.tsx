import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  FolderInput,
  FolderPlus,
  Grid2X2,
  Link2,
  List,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { byteLabel, joined, nameOf, objectCategory, renamePlan } from "@r2client/core";
import type {
  Detail,
  Index,
  Item,
  Mutation,
  Outcome,
  Page,
  Profile,
  RenameRule,
} from "@r2client/core";
import { dateLabel, Empty, FileIcon, IconButton, Modal } from "./common";
import type { Platform, Preferences, Tr } from "./common";
import { ShareDialog } from "./sharing";

type Fn = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
const PAGE_SIZE = 24;
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
  const ref = useRef<HTMLDivElement>(null),
    [src, setSrc] = useState("");
  const isImage = objectCategory(item.key) === "image" && item.kind === "object" && prefs.preview;
  useEffect(() => {
    if (!isImage || !ref.current) return;
    let current = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void p.api
            .links(profile.id, item.key, 300, "preview")
            .then((url) => {
              if (current) setSrc(url);
            })
            .catch(() => {});
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(ref.current);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [profile.id, item.key, item.etag, isImage, p]);
  return (
    <div ref={ref} className={"thumbnail " + (item.kind === "folder" ? "thumbnail-folder" : "")}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setSrc("")}
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
  onDownload,
}: {
  p: Platform;
  profile: Profile;
  item: Item;
  t: Tr;
  close: () => void;
  onShare: () => void;
  onDownload: () => void;
}) {
  const [detail, setDetail] = useState<Detail>(),
    [url, setUrl] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState("");
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
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [p, profile.id, item.key, category]);
  return (
    <Modal title={nameOf(item.key)} open onClose={close} wide>
      <div className="dialog-body stack">
        <div className="media-preview">
          {url && category === "image" ? (
            <img src={url} alt={nameOf(item.key)} />
          ) : url && category === "video" ? (
            <video src={url} controls preload="metadata" />
          ) : url && category === "audio" ? (
            <audio src={url} controls preload="metadata" />
          ) : url && category === "pdf" ? (
            <iframe src={url} title={nameOf(item.key)} />
          ) : text ? (
            <pre>{text}</pre>
          ) : (
            <FileIcon item={item} size={45} />
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
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
        <div className="row gap">
          <button className="button primary" onClick={onDownload}>
            <ArrowDownToLine size={15} /> {t("Download", "下载")}
          </button>
          <button className="button" onClick={onShare}>
            <Link2 size={15} /> {t("Share", "分享")}
          </button>
        </div>
      </div>
    </Modal>
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
  const [page, setPage] = useState<Page>({ items: [] }),
    [cursor, setCursor] = useState<(string | undefined)[]>([undefined]),
    [remote, setRemote] = useState(0),
    [local, setLocal] = useState(0);
  const [version, refresh] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [sort, setSort] = useState<Sort>("newest"),
    [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Map<string, Item>>(new Map()),
    [preview, setPreview] = useState<Item>(),
    [share, setShare] = useState<Item>(),
    [action, setAction] = useState<Action>();
  const [links, setLinks] = useState<{ name: string; url: string }[]>(),
    [menu, setMenu] = useState<string>(),
    [syncing, setSyncing] = useState(false);
  const [fallbackCount, setFallbackCount] = useState(0);
  useEffect(() => {
    setCursor([undefined]);
    setRemote(0);
    setLocal(0);
    setSelected(new Map());
    setQuery("");
    setMenu(undefined);
    setSearching(false);
  }, [profile.id, prefix]);
  const current = cursor[remote];
  useEffect(() => {
    if (!connected) return;
    let valid = true;
    setLoading(true);
    setError("");
    void p.api
      .list(profile.id, prefix, current)
      .then((v) => {
        if (valid) setPage(v);
      })
      .catch((e) => {
        if (valid) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [p, profile.id, prefix, connected, current, version]);
  useEffect(() => {
    if (!connected || !prefs.autoRefresh) return;
    const timer = setInterval(() => refresh((x) => x + 1), prefs.autoRefresh * 60_000);
    return () => clearInterval(timer);
  }, [connected, prefs.autoRefresh]);
  const source = searching && query && index ? index.objects : page.items;
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source
      .filter(
        (x) =>
          (!q || x.key.toLowerCase().includes(q)) &&
          (!category || x.kind === "folder" || objectCategory(x.key) === category),
      )
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        if (sort === "size") return b.size - a.size;
        if (sort === "name") return a.key.localeCompare(b.key);
        return sort === "newest"
          ? b.modified.localeCompare(a.modified)
          : a.modified.localeCompare(b.modified);
      });
  }, [source, query, category, sort]);
  const shown = sorted.slice(local * PAGE_SIZE, (local + 1) * PAGE_SIZE),
    localMax = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)),
    isIndexedSearch = !!(searching && query && index);
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
  function next() {
    if (local + 1 < localMax) {
      setLocal(local + 1);
      return;
    }
    if (page.next && !isIndexedSearch) {
      setCursor((prev) => {
        const p = [...prev];
        p[remote + 1] = page.next;
        return p;
      });
      setRemote(remote + 1);
      setLocal(0);
    }
  }
  function prev() {
    if (local > 0) setLocal(local - 1);
    else if (remote > 0) {
      setRemote(remote - 1);
      setLocal(0);
    }
  }
  async function sync() {
    setSyncing(true);
    const v = await run(() => p.api.scan(profile.id), t("Bucket synced", "存储桶已同步"));
    if (v) {
      setIndex(v);
      refresh((x) => x + 1);
    }
    setSyncing(false);
  }
  async function download(items: Item[]) {
    if (!items.length) return;
    if (p.capabilities.folders) {
      await run(async () => {
        const dir = await p.api.pickDestination();
        if (!dir) return;
        await p.api.download(profile.id, items, dir, prefix, prefs.replace);
        notify(t("Added to transfers", "已加入传输队列"));
      });
    } else {
      const objects: Item[] = [];
      for (const item of items) {
        if (item.kind === "object") objects.push(item);
        else {
          const scan = index ?? (await run(() => p.api.scan(profile.id)));
          if (scan)
            objects.push(
              ...scan.objects.filter((o) => o.key.startsWith(item.key) && !o.key.endsWith("/")),
            );
        }
      }
      const r = await run(() =>
        Promise.all(
          objects.slice(0, 100).map(async (item) => ({
            name: item.key,
            url: await p.api.links(profile.id, item.key, 900, "download"),
          })),
        ),
      );
      if (r) {
        setFallbackCount(objects.length);
        setLinks(r);
      }
    }
  }
  const chosen = [...selected.values()];
  const crumbs = prefix.split("/").filter(Boolean);
  const hasNext = local + 1 < localMax || !!(page.next && !isIndexedSearch);
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
        <div className="breadcrumbs">
          <button className="crumb" onClick={() => go("")}>
            {t("All files", "所有文件", "すべてのファイル", "모든 파일")}
          </button>
          {crumbs.map((name, i) => (
            <span key={i}>
              <ChevronRight size={13} />
              <button className="crumb" onClick={() => go(crumbs.slice(0, i + 1).join("/") + "/")}>
                {name}
              </button>
            </span>
          ))}
        </div>
        <div className="toolbar-actions">
          <button
            className={"button " + (searching ? "selected" : "")}
            onClick={() => {
              setSearching(!searching);
              setQuery("");
              setLocal(0);
            }}
          >
            <Search size={15} /> {t("Search", "搜索", "検索", "검색")}
          </button>
          <button className="button primary" onClick={upload} disabled={!connected}>
            <ArrowUpToLine size={15} /> {t("Upload", "上传", "アップロード", "업로드")}
          </button>
          <div className="segmented">
            <IconButton
              label={t("Grid", "网格", "グリッド", "격자")}
              className={prefs.view === "grid" ? "active" : ""}
              onClick={() => setPrefs({ view: "grid" })}
            >
              <Grid2X2 size={16} />
            </IconButton>
            <IconButton
              label={t("List", "列表", "一覧", "목록")}
              className={prefs.view === "list" ? "active" : ""}
              onClick={() => setPrefs({ view: "list" })}
            >
              <List size={18} />
            </IconButton>
          </div>
          <IconButton
            label={t("Refresh", "刷新")}
            disabled={!connected || loading}
            onClick={() => refresh((x) => x + 1)}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </IconButton>
          <IconButton
            label={labels(t).folder}
            disabled={!connected}
            onClick={() => setAction("folder")}
          >
            <FolderPlus size={17} />
          </IconButton>
        </div>
      </div>
      {searching && (
        <div className="searchbar">
          <Search size={16} />
          <input
            autoFocus
            aria-label={t("Search objects", "搜索对象")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLocal(0);
            }}
            placeholder={
              index ? t("Search the bucket", "搜索整个存储桶") : t("Search this page", "搜索当前页")
            }
          />
          {!index && (
            <button className="button" disabled={syncing} onClick={() => void sync()}>
              {t("Index bucket", "索引整个存储桶")}
            </button>
          )}
        </div>
      )}
      <div className="file-subbar">
        <label className="check">
          <input type="checkbox" checked={all} onChange={selectAll} />{" "}
          {t("Select all", "全选", "全選択", "전체 선택")}
        </label>
        {chosen.length > 0 && (
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
          </div>
        )}
        <div className="spacer" />
        <select
          aria-label={t("Filter files", "筛选文件")}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLocal(0);
          }}
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
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            setLocal(0);
          }}
        >
          <option value="newest">{t("Newest first", "最新优先")}</option>
          <option value="oldest">{t("Oldest first", "最早优先")}</option>
          <option value="name">{t("Name", "名称")}</option>
          <option value="size">{t("Largest first", "最大优先")}</option>
        </select>
      </div>
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
                {t("Name", "名称")}
                <span>{t("Size", "大小")}</span>
                <span>{t("Modified", "最后更新")}</span>
                <span />
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
                      <Thumb p={p} profile={profile} item={item} prefs={prefs} t={t} />
                    </button>
                  ) : null}
                  <button
                    className="file-name"
                    onClick={(e) => (e.ctrlKey || e.metaKey ? choose(item) : open())}
                    title={item.key}
                  >
                    {prefs.view === "list" && <FileIcon item={item} size={18} />}
                    <span>{isIndexedSearch ? item.key : nameOf(item.key)}</span>
                  </button>
                  {prefs.view === "grid" ? (
                    <div className="file-data">
                      <span>{dateLabel(item.modified)}</span>
                      <span>{item.kind === "object" ? byteLabel(item.size) : ""}</span>
                    </div>
                  ) : (
                    <>
                      <span className="muted">
                        {item.kind === "object" ? byteLabel(item.size) : "—"}
                      </span>
                      <span className="muted">{dateLabel(item.modified)}</span>
                    </>
                  )}
                  <div className="file-actions">
                    {item.kind === "object" && (
                      <IconButton
                        label={t("Share", "分享") + " " + nameOf(item.key)}
                        onClick={() => setShare(item)}
                      >
                        <Link2 size={15} />
                      </IconButton>
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
                        <button
                          onClick={() => {
                            setMenu(undefined);
                            void download([item]);
                          }}
                        >
                          <ArrowDownToLine size={15} />
                          {t("Download", "下载")}
                        </button>
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
          <IconButton
            label={t("Previous page", "上一页")}
            disabled={remote === 0 && local === 0}
            onClick={prev}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <span>
            {t("Page", "页")} {remote * Math.ceil(200 / PAGE_SIZE) + local + 1} · {shown.length}{" "}
            {t("items", "项")}
          </span>
          <IconButton label={t("Next page", "下一页")} disabled={!hasNext} onClick={next}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
      </footer>
      {preview && (
        <Preview
          p={p}
          profile={profile}
          item={preview}
          t={t}
          close={() => setPreview(undefined)}
          onShare={() => {
            setShare(preview);
            setPreview(undefined);
          }}
          onDownload={() => void download([preview])}
        />
      )}
      {share && (
        <ShareDialog
          platform={p}
          profile={profile}
          item={share}
          prefs={prefs}
          t={t}
          close={() => setShare(undefined)}
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
      {links && (
        <Modal title={t("Download files", "下载文件")} open onClose={() => setLinks(undefined)}>
          <div className="dialog-body stack">
            {fallbackCount > links.length && (
              <div className="notice">
                {t(
                  "The first 100 links are shown. Use a browser with directory access for larger batches.",
                  "仅显示前 100 个链接。批量下载更多文件请使用支持目录访问的浏览器。",
                )}
              </div>
            )}
            {links.map((x) => (
              <a
                className="button truncate"
                download={nameOf(x.name)}
                key={x.name}
                href={x.url}
                rel="noreferrer"
              >
                <ArrowDownToLine size={14} />
                {x.name}
              </a>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}
