import {
  ArrowDownToLine,
  ArrowUpToLine,
  Clipboard,
  ClipboardPaste,
  FilePlus,
  FolderOpen,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { byteLabel, nameOf, objectCategory } from "@r2client/core";
import type { Job, Preset, Profile, Snapshot, Source } from "@r2client/core";
import { dateLabel, Empty, FileIcon, IconButton, Modal, splitUrls } from "./common";
import type { Platform, Preferences, Tr } from "./common";
import { copyText } from "./sharing";

type Run = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
export function MediaDialog({
  source,
  t,
  close,
  convert,
  count = 1,
}: {
  source: Source;
  t: Tr;
  close: () => void;
  convert: (preset: Preset, keep: boolean) => Promise<void>;
  count?: number;
}) {
  const category = objectCategory(source.name);
  const formats: Preset["format"][] =
    category === "image"
      ? ["jpg", "png", "webp", "avif"]
      : category === "audio"
        ? ["mp3", "aac", "ogg", "flac"]
        : ["mp4", "webm", "avi", "mkv"];
  const [value, change] = useState<Preset>({
    format: formats[0]!,
    quality: 80,
    autoRotate: true,
    stripMetadata: false,
    codec: "h264",
    rateMode: "vbr",
  });
  const [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [keep, setKeep] = useState(false);
  const set = (p: Partial<Preset>) => change((v) => ({ ...v, ...p }));
  return (
    <Modal
      open
      title={t("Convert media", "媒体转换")}
      onClose={() => {
        if (!working) close();
      }}
    >
      <form
        className="dialog-body stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setWorking(true);
          setError("");
          try {
            await convert(value, keep);
            close();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setWorking(false);
          }
        }}
      >
        <span className="muted truncate">
          {count === 1 ? source.name : count + " " + t("files", "个文件")}
        </span>
        <label>
          {t("Output format", "输出格式")}
          <select
            value={value.format}
            onChange={(e) => set({ format: e.target.value as Preset["format"] })}
          >
            {formats.map((x) => (
              <option key={x} value={x}>
                {x.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        {category !== "audio" && (
          <>
            <label>
              {t("Quality", "质量")} · {value.quality}%
              <input
                type="range"
                min="1"
                max="100"
                value={value.quality}
                onChange={(e) => set({ quality: +e.target.value })}
              />
            </label>
            <div className="form-columns">
              <label>
                {t("Maximum width", "最大宽度")}
                <input
                  type="number"
                  min="2"
                  max="8192"
                  value={value.width ?? ""}
                  onChange={(e) => set({ width: +e.target.value || undefined })}
                />
              </label>
              <label>
                {t("Maximum height", "最大高度")}
                <input
                  type="number"
                  min="2"
                  max="8192"
                  value={value.height ?? ""}
                  onChange={(e) => set({ height: +e.target.value || undefined })}
                />
              </label>
            </div>
          </>
        )}
        {category === "video" && (
          <div className="form-columns">
            <label>
              {t("Video codec", "视频编码")}
              <select
                value={value.codec}
                onChange={(e) => set({ codec: e.target.value as Preset["codec"] })}
              >
                <option value="h264">H.264</option>
                <option value="h265">H.265</option>
                <option value="vp9">VP9</option>
              </select>
            </label>
            <label>
              {t("Bitrate mode", "码率模式")}
              <select
                value={value.rateMode}
                onChange={(e) => set({ rateMode: e.target.value as Preset["rateMode"] })}
              >
                <option value="vbr">VBR</option>
                <option value="cbr">CBR</option>
              </select>
            </label>
          </div>
        )}
        {(category === "audio" || value.rateMode === "cbr") && (
          <label>
            {t("Bitrate (kbps)", "码率（kbps）")}
            <input
              type="number"
              min="16"
              max="30000"
              value={value.bitrate ?? ""}
              onChange={(e) => set({ bitrate: +e.target.value || undefined })}
            />
          </label>
        )}
        {category === "audio" && (
          <label>
            {t("Sample rate", "采样率")}
            <select
              value={value.sampleRate ?? ""}
              onChange={(e) => set({ sampleRate: +e.target.value || undefined })}
            >
              <option value="">{t("Original", "保持原样")}</option>
              <option value="44100">44.1 kHz</option>
              <option value="48000">48 kHz</option>
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={value.stripMetadata}
            onChange={(e) => set({ stripMetadata: e.target.checked })}
          />{" "}
          {t("Strip metadata", "清除元数据")}
        </label>
        {category !== "audio" && (
          <label className="check">
            <input
              type="checkbox"
              checked={value.autoRotate}
              onChange={(e) => set({ autoRotate: e.target.checked })}
            />{" "}
            {t("Apply orientation", "自动修正方向")}
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />{" "}
          {t("Keep original in staging", "在暂存区保留原文件")}
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="row end gap">
          <button type="button" className="button" disabled={working} onClick={close}>
            {t("Cancel", "取消")}
          </button>
          <button className="button primary" disabled={working}>
            {working ? t("Converting…", "正在转换…") : t("Convert", "转换")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Uploads({
  p,
  snapshot,
  profile,
  prefix,
  prefs,
  t,
  run,
  changed,
  notify,
  transfers,
}: {
  p: Platform;
  snapshot: Snapshot;
  profile?: Profile;
  prefix: string;
  prefs: Preferences;
  t: Tr;
  run: Run;
  changed: () => Promise<void>;
  notify: (text: string) => void;
  transfers: () => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<Record<string, string>>({}),
    [url, setUrl] = useState<string>(),
    [media, setMedia] = useState<Source[]>(),
    [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(prefix),
    [replace, setReplace] = useState(prefs.replace),
    [summary, setSummary] = useState(false),
    [dedup, setDedup] = useState(false);
  useEffect(() => setTarget(prefix), [prefix, profile?.id]);
  const stages = snapshot.stages;
  async function pick(isDir: boolean) {
    if (p.capabilities.desktop)
      await run(async () => {
        await p.api.pickSources(isDir);
        await changed();
      });
    else (isDir ? folder : input).current?.click();
  }
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      await p.addFiles(
        [...files].map((file) => ({ file, relative: file.webkitRelativePath || file.name })),
      );
      await changed();
    });
  }
  async function paste() {
    await run(async () => {
      if (p.pasteNative) await p.pasteNative();
      else {
        const data = await navigator.clipboard.read();
        const list: File[] = [];
        for (const row of data) {
          const type = row.types.find((t) => t.startsWith("image/"));
          if (type)
            list.push(
              new File(
                [await row.getType(type)],
                "clipboard-" + Date.now() + "." + (type.split("/")[1] || "png"),
                { type },
              ),
            );
        }
        if (list.length) await p.addFiles(list.map((file) => ({ file })));
        else await p.api.importUrls(splitUrls(await navigator.clipboard.readText()));
      }
      await changed();
    });
  }
  async function send() {
    if (!profile) return;
    setBusy(true);
    const result = await run(async () => {
      const dest = target.replace(/^\/+|\/+$/g, ""),
        pre = dest ? dest + "/" : "";
      const skipped = await p.api.upload(
        profile.id,
        pre,
        stages.map((s) => ({ id: s.id, name: names[s.id] ?? s.name })),
        replace,
        prefs.concurrency,
        dedup,
      );
      await changed();
      return skipped;
    });
    setBusy(false);
    if (result !== undefined) {
      notify(
        result
          ? t("Duplicates skipped: ", "已跳过重复文件：") + result
          : t("Added to transfers", "已加入传输队列"),
      );
      transfers();
    }
  }
  function markdown() {
    const rows = stages
      .map((s) => "- " + (names[s.id] ?? s.name) + " · " + byteLabel(s.size))
      .join("\n");
    return "# " + (profile?.label ?? "R2") + "\n\n" + rows;
  }
  return (
    <section className="screen-scroll">
      <header className="screen-header">
        <div>
          <h1>{t("Upload files", "上传文件", "アップロード", "업로드")}</h1>
          <p>
            {profile?.label ?? "—"}
            {target ? " / " + target : ""}
          </p>
        </div>
      </header>
      <div
        className="upload-drop"
        onClick={() => void pick(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void pick(false);
        }}
        role="button"
        tabIndex={0}
      >
        <div className="upload-glyph">
          <UploadCloud size={32} strokeWidth={1.5} />
        </div>
        <strong>{t("Drop files or folders here", "拖拽文件或文件夹到此处")}</strong>
        <span>{t("or select files", "或选择文件")}</span>
      </div>
      <div className="row wrap gap upload-tools">
        <button className="button" onClick={() => void pick(false)}>
          <FilePlus size={16} /> {t("Browse files", "选择文件")}
        </button>
        <button className="button" onClick={() => void pick(true)}>
          <FolderOpen size={16} /> {t("Choose folder", "选择文件夹")}
        </button>
        <button className="button" onClick={() => setUrl("")}>
          <Link2 size={16} /> {t("Add URLs", "添加 URL")}
        </button>
        <button className="button" onClick={() => void paste()}>
          <ClipboardPaste size={16} /> {t("Paste from clipboard", "从剪贴板粘贴")}
        </button>
      </div>
      <input
        hidden
        ref={input}
        multiple
        type="file"
        onChange={(e) => {
          void handleFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        hidden
        ref={folder}
        multiple
        type="file"
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          void handleFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      {stages.length > 0 && (
        <div className="panel stack">
          <div className="row between">
            <h2>
              {t("Staged files", "待上传文件")} <span className="count">{stages.length}</span>
            </h2>
            <button className="button" onClick={() => setSummary(true)}>
              <Clipboard size={15} /> Markdown
            </button>
          </div>
          {p.capabilities.desktop && (
            <div className="row wrap gap">
              {["image", "audio", "video"].map((category) => {
                const rows = stages.filter((s) => objectCategory(s.name) === category);
                return rows.length > 1 ? (
                  <button key={category} className="button" onClick={() => setMedia(rows)}>
                    <ScanLine size={15} /> {t("Batch convert", "批量转换")} · {category} (
                    {rows.length})
                  </button>
                ) : null;
              })}
            </div>
          )}
          {stages.map((s) => (
            <div className="stage-row" key={s.id}>
              <FileIcon item={{ key: s.name, kind: "object" }} size={17} />
              <input
                aria-label={t("Upload name", "上传名称")}
                value={names[s.id] ?? s.name}
                onChange={(e) => setNames((v) => ({ ...v, [s.id]: e.target.value }))}
              />
              <span className="muted">{byteLabel(s.size)}</span>
              {p.capabilities.desktop &&
                ["image", "video", "audio"].includes(objectCategory(s.name)) && (
                  <IconButton label={t("Convert media", "媒体转换")} onClick={() => setMedia([s])}>
                    <ScanLine size={15} />
                  </IconButton>
                )}
              <IconButton
                label={t("Remove", "移除")}
                onClick={() =>
                  void run(async () => {
                    await p.api.unstage(s.id);
                    await changed();
                  })
                }
              >
                <X size={16} />
              </IconButton>
            </div>
          ))}
          <label>
            {t("Destination prefix", "目标前缀")}
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={t("Bucket root", "存储桶根目录")}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={dedup} onChange={(e) => setDedup(e.target.checked)} />{" "}
            {t("Skip content already in this folder", "跳过目录内内容相同的文件")}
          </label>
          <div className="row between wrap gap">
            <label className="check">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />{" "}
              {t("Replace existing objects", "覆盖已有同名对象")}
            </label>
            <button
              className="button primary"
              disabled={busy || !profile || !snapshot.connected.includes(profile.id)}
              onClick={() => void send()}
            >
              <ArrowUpToLine size={16} />{" "}
              {busy ? t("Queuing…", "正在排队…") : t("Start upload", "开始上传")}
            </button>
          </div>
        </div>
      )}
      {url !== undefined && (
        <Modal title={t("Import URLs", "导入 URL")} open onClose={() => setUrl(undefined)}>
          <form
            className="dialog-body stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(async () => {
                await p.api.importUrls(splitUrls(url));
                await changed();
                return true;
              });
              if (r) setUrl(undefined);
            }}
          >
            <label>
              {t("File URLs", "文件直链")}
              <textarea
                autoFocus
                placeholder={"https://example.com/file.pdf"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                rows={5}
                required
              />
            </label>
            {!p.capabilities.desktop && (
              <div className="subtle">
                {t("The source must allow browser access.", "来源站点需要允许浏览器跨域读取。")}
              </div>
            )}
            <div className="row end">
              <button className="button primary">
                <Plus size={15} /> {t("Add to staging", "加入暂存区")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {summary && (
        <Modal
          title={t("Markdown manifest", "Markdown 清单")}
          open
          onClose={() => setSummary(false)}
        >
          <div className="dialog-body stack">
            <textarea readOnly rows={9} value={markdown()} />
            <button
              className="button"
              onClick={() => void run(() => copyText(p, markdown()), t("Copied", "已复制"))}
            >
              <Clipboard size={15} /> {t("Copy manifest", "复制清单")}
            </button>
          </div>
        </Modal>
      )}
      {media?.[0] && (
        <MediaDialog
          source={media[0]}
          count={media.length}
          t={t}
          close={() => setMedia(undefined)}
          convert={async (preset, keep) => {
            for (const source of media) {
              await p.api.convert(source.id, preset, keep);
              await changed();
            }
          }}
        />
      )}
    </section>
  );
}
const status = (t: Tr): Record<Job["state"], string> => ({
  queued: t("Queued", "排队中"),
  running: t("Running", "传输中"),
  paused: t("Paused", "已暂停"),
  failed: t("Failed", "失败"),
  completed: t("Completed", "已完成"),
  cancelled: t("Cancelled", "已取消"),
});
export function TransfersPanel({
  p,
  snapshot,
  t,
  run,
  changed,
}: {
  p: Platform;
  snapshot: Snapshot;
  t: Tr;
  run: Run;
  changed: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Job["state"] | "all">("all"),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const file = useRef<HTMLInputElement>(null),
    attaching = useRef("");
  const statuses = status(t),
    jobs = snapshot.jobs.filter((j) => filter === "all" || j.state === filter);
  async function act(job: Job, action: Parameters<Platform["api"]["job"]>[1]) {
    await run(async () => {
      await p.api.job(job.id, action);
      await changed();
    });
  }
  function attach(job: Job) {
    attaching.current = job.id;
    file.current?.click();
  }
  async function links() {
    await run(
      async () => {
        const urls = await Promise.all(
          snapshot.jobs
            .filter(
              (j) => selected.has(j.id) && j.state === "completed" && j.direction === "upload",
            )
            .map((j) => p.api.links(j.profileId, j.key, 3600, "signed")),
        );
        if (!urls.length) throw new Error("Select completed uploads first");
        await copyText(p, urls.join("\n"));
      },
      t("Links copied", "链接已复制"),
    );
  }
  return (
    <section className="screen-scroll">
      <header className="screen-header">
        <div>
          <h1>{t("Transfers", "传输管理", "転送", "전송")}</h1>
          <p>
            {snapshot.jobs.filter((j) => j.state === "running").length} {t("active", "项进行中")}
          </p>
        </div>
        <div className="row gap">
          <button className="button" disabled={!selected.size} onClick={() => void links()}>
            <Clipboard size={15} /> {t("Copy links", "复制链接")}
          </button>
          <button
            className="button"
            onClick={() =>
              void run(async () => {
                await p.api.clearCompleted();
                await changed();
              })
            }
          >
            <Trash2 size={15} /> {t("Clear completed", "清除已完成")}
          </button>
        </div>
      </header>
      <div className="filter-tabs">
        {(["all", "queued", "running", "paused", "failed", "completed", "cancelled"] as const).map(
          (x) => (
            <button
              key={x}
              className={"button " + (x === filter ? "selected" : "")}
              onClick={() => setFilter(x)}
            >
              {x === "all" ? t("All", "全部") : statuses[x]}{" "}
              <span className="count">
                {x === "all"
                  ? snapshot.jobs.length
                  : snapshot.jobs.filter((j) => j.state === x).length}
              </span>
            </button>
          ),
        )}
      </div>
      {!jobs.length ? (
        <Empty label={t("No transfers here", "暂无传输任务")} />
      ) : (
        <div className="panel transfers-list">
          <label className="check list-select">
            <input
              type="checkbox"
              checked={jobs.every((j) => selected.has(j.id))}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(jobs.map((j) => j.id)) : new Set())
              }
            />{" "}
            {t("Select all", "全选")}
          </label>
          {jobs.map((j) => {
            const Icon = j.direction === "upload" ? ArrowUpToLine : ArrowDownToLine;
            const running = j.state === "running" || j.state === "queued",
              restorable = j.state === "paused" || j.state === "failed";
            const seconds = Math.max(1, (Date.parse(j.updated) - Date.parse(j.created)) / 1000);
            return (
              <div className="transfer-row" key={j.id}>
                <input
                  type="checkbox"
                  aria-label={t("Select", "选择") + " " + j.key}
                  checked={selected.has(j.id)}
                  onChange={(e) =>
                    setSelected((old) => {
                      const v = new Set(old);
                      if (e.target.checked) v.add(j.id);
                      else v.delete(j.id);
                      return v;
                    })
                  }
                />
                <Icon size={18} className="transfer-icon" />
                <div className="transfer-text">
                  <strong className="truncate" title={j.key}>
                    {nameOf(j.key)}
                  </strong>
                  <small>
                    {snapshot.profiles.find((p) => p.id === j.profileId)?.label} ·{" "}
                    {dateLabel(j.created)}
                  </small>
                  {j.error && <small className="danger-text">{j.error}</small>}
                </div>
                <div className="transfer-progress">
                  <progress
                    aria-label={t("Transfer progress", "传输进度")}
                    max={j.total || 1}
                    value={j.total ? j.done : j.state === "completed" ? 1 : 0}
                  />
                  <small>
                    {byteLabel(j.done)} / {byteLabel(j.total)}
                    {j.state === "running" ? " · " + byteLabel(j.done / seconds) + "/s" : ""}
                  </small>
                </div>
                <span className={"status-pill " + j.state}>{statuses[j.state]}</span>
                <div className="row gap transfer-actions">
                  {running && (
                    <IconButton label={t("Pause", "暂停")} onClick={() => void act(j, "pause")}>
                      <Pause size={16} />
                    </IconButton>
                  )}
                  {restorable && (
                    <>
                      <IconButton label={t("Resume", "继续")} onClick={() => void act(j, "resume")}>
                        <Play size={16} />
                      </IconButton>
                      {j.direction === "upload" ? (
                        <IconButton
                          label={t("Reselect original file", "重新选择原文件")}
                          onClick={() => attach(j)}
                        >
                          <FilePlus size={15} />
                        </IconButton>
                      ) : (
                        <IconButton
                          label={t("Reauthorize download folder", "重新授权下载目录")}
                          onClick={() => void run(() => p.api.pickDestination())}
                        >
                          <FolderOpen size={16} />
                        </IconButton>
                      )}
                    </>
                  )}
                  {j.state === "completed" && j.direction === "upload" && (
                    <IconButton
                      label={t("Copy link", "复制链接")}
                      onClick={() =>
                        void run(
                          async () =>
                            copyText(p, await p.api.links(j.profileId, j.key, 3600, "signed")),
                          t("Copied", "已复制"),
                        )
                      }
                    >
                      <Link2 size={16} />
                    </IconButton>
                  )}
                  {j.state === "completed" &&
                    j.direction === "download" &&
                    j.destination &&
                    p.capabilities.desktop && (
                      <IconButton
                        label={t("Open folder", "打开目录")}
                        onClick={() =>
                          void run(() => p.api.revealDestination(JSON.parse(j.destination!)[0]))
                        }
                      >
                        <FolderOpen size={16} />
                      </IconButton>
                    )}
                  {["completed", "cancelled"].includes(j.state) ? (
                    <IconButton
                      label={t("Remove record", "移除记录")}
                      onClick={() => void act(j, "remove")}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  ) : (
                    <IconButton
                      label={t("Cancel transfer", "取消传输")}
                      onClick={() => void act(j, "cancel")}
                    >
                      <X size={16} />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <input
        type="file"
        hidden
        ref={file}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0],
            id = attaching.current;
          e.currentTarget.value = "";
          if (f && id)
            void run(async () => {
              await p.attachFile(id, f);
              await p.api.job(id, "resume");
              await changed();
            });
        }}
      />
      <button className="button ghost screen-bottom" onClick={() => void changed()}>
        <RotateCcw size={14} /> {t("Refresh transfers", "刷新传输")}
      </button>
    </section>
  );
}
