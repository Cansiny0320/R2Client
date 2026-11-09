import { Popover } from "@base-ui/react/popover";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clipboard,
  ClipboardPaste,
  Database,
  FilePlus,
  Folder,
  FolderOpen,
  Inbox,
  Link2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  Trash2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { byteLabel, nameOf, objectCategory } from "@r2client/core";
import type { Job, Preset, Profile, Snapshot, Source } from "@r2client/core";
import { dateLabel, Empty, IconButton, Modal, splitUrls } from "./common";
import type { Platform, Preferences, Tr } from "./common";
import { copyText } from "./sharing";
import { mediaCategories, MediaFields, MediaRules } from "./media-settings";
import type { MediaCategory, MediaDefaults } from "./media-settings";

type Run = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
export function MediaDialog({
  source,
  t,
  close,
  convert,
  count = 1,
  defaults,
}: {
  source: Source;
  t: Tr;
  close: () => void;
  convert: (preset: Preset, keep: boolean) => Promise<void>;
  count?: number;
  defaults: MediaDefaults;
}) {
  const category = objectCategory(source.name) as MediaCategory;
  const [value, change] = useState<Preset>({
    ...defaults[category].preset,
    timeoutMinutes: defaults.timeoutMinutes,
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
        <MediaFields category={category} value={value} set={set} t={t} />
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
  const [target, setTarget] = useState(prefix || "/"),
    [replace, setReplace] = useState(prefs.replace),
    [summary, setSummary] = useState(false),
    [dedup, setDedup] = useState(false),
    [showPicker, setShowPicker] = useState(false);
  useEffect(() => setTarget(prefix || "/"), [prefix, profile?.id]);
  const stages = snapshot.stages;
  const picking = showPicker || stages.length === 0;
  const [override, setOverride] = useState<MediaDefaults>();
  const [editingMedia, setEditingMedia] = useState(false);
  const [processingTab, setProcessingTab] = useState<"image" | "audio" | "other">("image");
  const [showStageArea, setShowStageArea] = useState(false);
  const mediaConfig = override ?? prefs.media;
  async function pick(isDir: boolean) {
    await run(async () => {
      await p.api.pickSources(isDir);
      setShowPicker(false);
      await changed();
    });
  }
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      await p.addFiles(
        [...files].map((file) => ({ file, relative: file.webkitRelativePath || file.name })),
      );
      setShowPicker(false);
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
      setShowPicker(false);
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
        stages.map((s) => {
          const category = objectCategory(s.name);
          const rule = mediaCategories.find((kind) => kind === category);
          const config = rule && mediaConfig[rule];
          const preset =
            !s.processed &&
            config?.enabled &&
            (!config.maxMiB || s.size <= config.maxMiB * 1024 * 1024)
              ? { ...config.preset, timeoutMinutes: mediaConfig.timeoutMinutes }
              : undefined;
          return { id: s.id, name: names[s.id] ?? s.name, preset };
        }),
        replace,
        prefs.uploadTuning,
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
      setOverride(undefined);
      transfers();
    }
  }
  function returnToPicker() {
    setShowStageArea(false);
    setShowPicker(true);
  }
  function markdown() {
    const rows = stages
      .map((s) => "- " + (names[s.id] ?? s.name) + " · " + byteLabel(s.size))
      .join("\n");
    return "# " + (profile?.label ?? "R2") + "\n\n" + rows;
  }
  return (
    <section className={"screen-scroll upload-screen" + (picking ? "" : " staged-upload-screen")}>
      {picking && (
        <div className="upload-drop upload-drop-empty">
          <div className="upload-glyph" aria-hidden="true">
            <UploadIcon size={36} />
          </div>
          <h1>{t("Drag and drop files here, or", "将文件拖拽到这里，或")}</h1>
          {target && target !== "/" && <span className="muted">{target}</span>}
          <div className="row wrap gap upload-tools">
            <button className="button" onClick={() => void pick(false)}>
              <FilePlus size={16} /> {t("Browse files", "选择文件")}
            </button>
            <button className="button" onClick={() => void pick(true)}>
              <FolderOpen size={16} /> {t("Choose folder", "选择文件夹")}
            </button>
            <button className="button" onClick={() => setUrl("")}>
              <Link2 size={16} /> {t("Add URL", "添加 URL")}
            </button>
            <button className="button" onClick={() => void paste()}>
              <ClipboardPaste size={16} /> {t("Paste from clipboard", "从剪贴板粘贴")}
            </button>
          </div>
          <ul className="upload-tips">
            <li>
              •{" "}
              {t(
                "Supports common image, document, and video formats",
                "支持常见图片、文档和视频格式",
              )}
            </li>
            <li>
              •{" "}
              {t(
                "Add multiple URLs separated by line breaks or spaces",
                "支持用换行或空格批量添加 URL",
              )}
            </li>
            <li>
              •{" "}
              {t(
                "Paste images, file paths, or URLs from the clipboard",
                "支持粘贴图片、文件路径或 URL",
              )}
            </li>
          </ul>
          {stages.length > 0 && (
            <button className="button staged-picker-return" onClick={() => setShowPicker(false)}>
              <Database size={16} /> {t("View staging area", "查看暂存区")} ({stages.length})
            </button>
          )}
        </div>
      )}
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
      {!picking && (
        <div className="staged-upload">
          <div className="staged-toolbar row wrap">
            <div className="row gap staged-heading">
              <IconButton label={t("Back to file picker", "返回选择文件")} onClick={returnToPicker}>
                <ArrowLeft size={16} />
              </IconButton>
              <span className="staged-count">
                {stages.length} {stages.length === 1 ? t("file", "个文件") : t("files", "个文件")}
              </span>
              <button
                className="button staged-area-toggle"
                aria-expanded={showStageArea}
                aria-controls="upload-stage-area"
                onClick={() => setShowStageArea(!showStageArea)}
              >
                <Database size={16} />
                {showStageArea
                  ? t("Hide staging area", "隐藏暂存区")
                  : t("View staging area", "查看暂存区")}
              </button>
            </div>
            <div className="row wrap gap staged-controls">
              <label className="staged-path">
                {t("Upload Path:", "上传路径：")}
                <input
                  className="staged-path-input"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              <Popover.Root
                open={editingMedia}
                onOpenChange={(open) => {
                  if (open) setProcessingTab("image");
                  setEditingMedia(open);
                }}
              >
                <Popover.Trigger className="button staged-processing-button">
                  <SlidersHorizontal size={16} /> {t("Processing Settings", "处理设置")}
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner
                    className="upload-processing-positioner"
                    align="end"
                    sideOffset={8}
                  >
                    <Popover.Popup className="upload-processing-popup">
                      <Popover.Title className="sr-only">
                        {t("Processing Settings", "处理设置")}
                      </Popover.Title>
                      <div
                        className="filter-tabs"
                        role="group"
                        aria-label={t("Processing category", "处理类型")}
                      >
                        {(
                          [
                            ["image", t("Image Processing", "图片处理")],
                            ["audio", t("Audio Processing", "音频处理")],
                            ["other", t("Other Settings", "其他设置")],
                          ] as const
                        ).map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            aria-pressed={processingTab === tab}
                            className={processingTab === tab ? "selected" : ""}
                            onClick={() => setProcessingTab(tab)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="stack upload-processing-body">
                        <MediaRules
                          value={mediaConfig}
                          set={setOverride}
                          t={t}
                          section={processingTab}
                          hasMatchingFiles={stages.some(
                            (stage) => objectCategory(stage.name) === processingTab,
                          )}
                        />
                        {processingTab === "other" && (
                          <>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={dedup}
                                onChange={(e) => setDedup(e.target.checked)}
                              />
                              {t("Skip content already in this folder", "跳过目录内内容相同的文件")}
                            </label>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={replace}
                                onChange={(e) => setReplace(e.target.checked)}
                              />
                              {t("Replace existing objects", "覆盖已有同名对象")}
                            </label>
                            <div className="row wrap gap">
                              {p.capabilities.desktop &&
                                mediaCategories.map((category) => {
                                  const rows = stages.filter(
                                    (stage) => objectCategory(stage.name) === category,
                                  );
                                  return rows.length > 1 ? (
                                    <button
                                      key={category}
                                      className="button"
                                      onClick={() => {
                                        setEditingMedia(false);
                                        setMedia(rows);
                                      }}
                                    >
                                      <ScanLine size={15} /> {t("Batch convert", "批量转换")} ·{" "}
                                      {category} ({rows.length})
                                    </button>
                                  ) : null;
                                })}
                              <button
                                className="button"
                                onClick={() => {
                                  setEditingMedia(false);
                                  setSummary(true);
                                }}
                              >
                                <Clipboard size={15} /> Markdown
                              </button>
                              {override && (
                                <button className="button" onClick={() => setOverride(undefined)}>
                                  <RotateCcw size={15} /> {t("Reset to defaults", "恢复默认")}
                                </button>
                              )}
                            </div>
                            <MediaRules
                              value={mediaConfig}
                              set={setOverride}
                              t={t}
                              section="video"
                            />
                          </>
                        )}
                      </div>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
              <button className="button" onClick={returnToPicker}>
                {t("Close", "关闭")}
              </button>
              <button
                className="button primary"
                disabled={busy || !profile || !snapshot.connected.includes(profile.id)}
                onClick={() => void send()}
              >
                {busy ? t("Queuing…", "正在排队…") : t("Start Upload", "开始上传")}
              </button>
            </div>
          </div>
          <div className="stage-columns" aria-hidden="true">
            <span>{t("File Name", "文件名")}</span>
            <span>{t("Size", "大小")}</span>
            <span>{t("Actions", "操作")}</span>
          </div>
          <div
            id="upload-stage-area"
            className={"staged-files" + (showStageArea ? " staged-files-expanded" : "")}
          >
            {showStageArea && (
              <div className="stage-area-heading row between">
                <span>{t("Staging Area", "暂存区")}</span>
                <button className="button" onClick={() => setShowStageArea(false)}>
                  {t("Close staging area", "关闭暂存区")}
                </button>
              </div>
            )}
            {stages.map((s) => (
              <div className="stage-row" key={s.id}>
                <Folder className="stage-file-icon" aria-hidden="true" size={16} />
                <input
                  className="stage-name"
                  aria-label={t("Upload name", "上传名称")}
                  title={names[s.id] ?? s.name}
                  value={names[s.id] ?? s.name}
                  onChange={(e) => setNames((v) => ({ ...v, [s.id]: e.target.value }))}
                />
                <span className="stage-size">
                  {s.size < 1024 ? s.size + t(" Bytes", " 字节") : byteLabel(s.size)}
                </span>
                <div className="stage-actions">
                  {p.capabilities.desktop &&
                    ["image", "video", "audio"].includes(objectCategory(s.name)) && (
                      <IconButton
                        label={t("Convert media", "媒体转换")}
                        onClick={() => setMedia([s])}
                      >
                        <ScanLine size={15} />
                      </IconButton>
                    )}
                  <IconButton
                    label={t("Remove", "移除")}
                    onClick={() =>
                      void run(async () => {
                        await p.api.unstage(s.id);
                        if (stages.length === 1) setShowStageArea(false);
                        await changed();
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {url !== undefined && (
        <Modal
          className="remote-files-dialog"
          title={t("Add Remote Files", "添加远程文件")}
          open
          onClose={() => setUrl(undefined)}
        >
          <form
            className="dialog-body stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(async () => {
                await p.api.importUrls(splitUrls(url));
                setShowPicker(false);
                await changed();
                return true;
              });
              if (r) setUrl(undefined);
            }}
          >
            <p>
              {t(
                "Add remote file URLs, supports batch input (one per line, comma, or space separated)",
                "添加远程文件 URL，支持按换行、逗号或空格批量输入",
              )}
            </p>
            <textarea
              aria-label={t("File URLs", "文件直链")}
              autoFocus
              placeholder={t(
                "Paste URL links here, supports\n• One per line\n• Comma separated\n• Space separated\n\nExample:\nhttps://example.com/image1.jpg\nhttps://example.com/image2.png, https://example.com/video.mp4",
                "在这里粘贴 URL，支持\n• 每行一个\n• 逗号分隔\n• 空格分隔\n\n示例：\nhttps://example.com/image1.jpg\nhttps://example.com/image2.png, https://example.com/video.mp4",
              )}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              rows={8}
              required
            />
            {p.capabilities.desktop && (
              <aside className="remote-files-note">
                <strong>⚠️ {t("Important Notes:", "注意事项：")}</strong>
                <p>
                  •{" "}
                  {t(
                    "Supports HTTP and HTTPS, up to 100 MB per file",
                    "支持 HTTP 和 HTTPS，每个文件最大 100 MB",
                  )}
                </p>
                <p>
                  •{" "}
                  {t(
                    "Downloads time out after two minutes. Use direct links that do not require signing in.",
                    "远程下载限时两分钟。请使用无需登录的文件直链。",
                  )}
                </p>
                <p>
                  •{" "}
                  {t(
                    "Files are downloaded to a temporary folder and removed after they are successfully uploaded.",
                    "文件会下载到临时目录，上传成功后自动清理。",
                  )}
                </p>
              </aside>
            )}
            <div className="remote-files-footer row gap">
              <p>
                {t(
                  "Separate links with line breaks, commas, semicolons, or spaces. Duplicate links are removed.",
                  "用换行、逗号、分号或空格分隔链接，重复链接会自动移除。",
                )}
              </p>
              <button type="button" className="button" onClick={() => setUrl(undefined)}>
                {t("Cancel", "取消")}
              </button>
              <button className="button primary" disabled={!url.trim()}>
                {t("Add", "添加")}
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
          defaults={mediaConfig}
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
  const [filter, setFilter] = useState<"all" | "queued" | "running" | "completed" | "failed">(
      "all",
    ),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [pending, setPending] = useState<Set<string>>(new Set());
  const file = useRef<HTMLInputElement>(null),
    attaching = useRef("");
  const statuses = status(t),
    jobs = snapshot.jobs.filter((j) => filter === "all" || j.state === filter);
  const hasDownloads = snapshot.jobs.some((job) => job.direction === "download");
  const completedUploads = snapshot.jobs.filter(
    (job) => job.state === "completed" && job.direction === "upload",
  );
  const selectedUploads = completedUploads.filter((job) => selected.has(job.id));
  const allSelected =
    completedUploads.length > 0 && completedUploads.length === selectedUploads.length;
  const emptyCopy = {
    all: [
      t("No transfer tasks", "暂无传输任务"),
      t(
        "Add files in the Upload tab or download them from Files to see their progress here.",
        "在上传页添加文件，或在文件列表下载文件，即可在这里查看进度。",
      ),
    ],
    queued: [
      t("No files in queue", "队列中暂无文件"),
      t(
        "New transfer tasks will appear here while they wait to start.",
        "新增的传输任务会在这里等待开始。",
      ),
    ],
    running: [
      t("No transfers in progress", "暂无进行中的传输"),
      t("Active transfers will appear here with their progress.", "进行中的传输会在这里显示进度。"),
    ],
    completed: [
      t("No completed transfers yet", "暂无已完成的传输"),
      t("Completed transfers will appear here.", "已完成的传输会显示在这里。"),
    ],
    failed: [
      t("No failed transfers", "暂无失败的传输"),
      t(
        "Failed transfers will appear here with a retry action.",
        "失败的传输会显示在这里，可以重试。",
      ),
    ],
  }[filter] as [string, string];
  async function act(job: Job, action: Parameters<Platform["api"]["job"]>[1]) {
    setPending((old) => new Set(old).add(job.id));
    try {
      await run(async () => {
        await p.api.job(job.id, action);
        await changed();
      });
    } finally {
      setPending((old) => {
        const next = new Set(old);
        next.delete(job.id);
        return next;
      });
    }
  }
  function attach(job: Job) {
    attaching.current = job.id;
    file.current?.click();
  }
  async function links() {
    await run(
      async () => {
        const urls = await Promise.all(
          selectedUploads.map((j) => p.api.links(j.profileId, j.key, 3600, "signed")),
        );
        if (!urls.length) throw new Error("Select completed uploads first");
        await copyText(p, urls.join("\n"));
      },
      t("Links copied", "链接已复制"),
    );
  }
  return (
    <section className="screen-scroll transfers-screen">
      <div className="row between wrap gap">
        <div className="filter-tabs" role="group" aria-label={t("Transfer status", "传输状态")}>
          {(["all", "queued", "running", "completed", "failed"] as const).map((status) => (
            <button
              type="button"
              key={status}
              className={status === filter ? "selected" : ""}
              aria-pressed={status === filter}
              onClick={() => setFilter(status)}
            >
              {status === "all"
                ? t("All", "全部")
                : status === "running" && !hasDownloads
                  ? t("Uploading", "上传中")
                  : statuses[status]}
              {status === "all" && <span className="transfer-count">{snapshot.jobs.length}</span>}
            </button>
          ))}
        </div>
        <div className="row wrap transfer-toolbar-actions">
          {completedUploads.length > 0 && (
            <button
              className="button"
              aria-pressed={allSelected}
              onClick={() =>
                setSelected(
                  allSelected ? new Set() : new Set(completedUploads.map((job) => job.id)),
                )
              }
            >
              {allSelected ? t("Unselect all", "取消全选") : t("Select all", "全选")}
            </button>
          )}
          {selectedUploads.length > 0 && (
            <button className="button" onClick={() => void links()}>
              <Clipboard size={16} /> {t("Copy links", "复制链接")}
            </button>
          )}
          {snapshot.jobs.some((job) => job.state === "completed" || job.state === "cancelled") && (
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
          )}
        </div>
      </div>
      {!jobs.length ? (
        <div className="screen-empty">
          <Empty
            icon={<Inbox size={25} aria-hidden="true" />}
            label={emptyCopy[0]}
            description={emptyCopy[1]}
          />
        </div>
      ) : (
        <div className="transfers-list">
          <div className="transfer-columns">
            <span aria-hidden="true" />
            <span>{t("File Name", "文件名")}</span>
            <span>{t("Size", "大小")}</span>
            <span>{t("Actions", "操作")}</span>
          </div>
          {jobs.map((j) => {
            const running = j.state === "running" || j.state === "queued",
              restorable = j.state === "paused" || j.state === "failed";
            const finishing =
              j.direction === "download" &&
              j.state === "running" &&
              j.total > 0 &&
              j.done >= j.total;
            const complete = j.state === "completed";
            const cancelled = j.state === "cancelled";
            const changing = pending.has(j.id);
            const mark =
              j.state === "paused" ? (
                <Pause size={12} />
              ) : complete ? (
                <Check size={12} />
              ) : j.state === "failed" ? (
                <CircleAlert size={12} />
              ) : cancelled ? (
                <X size={12} />
              ) : (
                <span className="transfer-state-dot" />
              );
            const progress = j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
            const seconds = Math.max(1, (Date.parse(j.updated) - Date.parse(j.created)) / 1000);
            return (
              <div className="transfer-row" key={j.id}>
                <div className="transfer-select">
                  {complete && j.direction === "upload" && (
                    <input
                      type="checkbox"
                      aria-label={t("Select", "选择") + " " + j.key}
                      checked={selected.has(j.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((old) => {
                          const next = new Set(old);
                          if (checked) next.add(j.id);
                          else next.delete(j.id);
                          return next;
                        });
                      }}
                    />
                  )}
                </div>
                <div className="transfer-text">
                  <div className="row gap transfer-title">
                    <strong
                      className="truncate"
                      title={[
                        snapshot.profiles.find((profile) => profile.id === j.profileId)?.label,
                        j.key,
                        dateLabel(j.created),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {nameOf(j.key)}
                    </strong>
                    {finishing ? (
                      <span className="transfer-saving">{t("Saving file…", "正在保存文件…")}</span>
                    ) : (
                      <span className={"transfer-state " + j.state} title={statuses[j.state]}>
                        <span aria-hidden="true">{mark}</span>
                        <span className="sr-only">{statuses[j.state]}</span>
                      </span>
                    )}
                  </div>
                  {!complete && !cancelled && (
                    <div className="transfer-progress">
                      <progress
                        aria-label={t("Transfer progress", "传输进度")}
                        max={j.total || 1}
                        value={j.done}
                      />
                      <small className="transfer-measures">
                        <span>{progress}%</span>
                        <span>
                          {j.direction === "upload"
                            ? t("Uploaded", "已上传")
                            : t("Downloaded", "已下载")}{" "}
                          {byteLabel(j.done)} / {byteLabel(j.total)}
                        </span>
                        <span>
                          {t("Speed", "速度")}{" "}
                          {j.state === "running" && !finishing && j.done
                            ? byteLabel(j.done / seconds) + "/s"
                            : "--"}
                        </span>
                      </small>
                    </div>
                  )}
                  {j.error && <small className="danger-text">{j.error}</small>}
                </div>
                <span className="transfer-size muted">{byteLabel(j.total)}</span>
                <div className="row gap transfer-actions">
                  {running && (
                    <button
                      className="button"
                      disabled={changing}
                      onClick={() => void act(j, "pause")}
                    >
                      <Pause size={16} /> {t("Pause", "暂停")}
                    </button>
                  )}
                  {restorable && (
                    <>
                      <button
                        className="button"
                        type="button"
                        disabled={changing}
                        onClick={() => void act(j, "resume")}
                      >
                        {j.state === "failed" ? <RotateCcw size={16} /> : <Play size={16} />}
                        {j.state === "failed" ? t("Retry", "重试") : t("Resume", "继续")}
                      </button>
                      {j.direction === "upload" ? (
                        <IconButton
                          label={t("Reselect original file", "重新选择原文件")}
                          className="transfer-source-action"
                          onClick={() => attach(j)}
                        >
                          <FilePlus size={15} />
                        </IconButton>
                      ) : (
                        <IconButton
                          label={t("Select the original download folder", "选择原下载目录")}
                          className="transfer-source-action"
                          onClick={() =>
                            void run(async () => {
                              const destination = await p.api.pickDestination();
                              if (
                                destination &&
                                j.destination &&
                                destination !== JSON.parse(j.destination)[0]
                              )
                                throw new Error(
                                  t(
                                    "Select the folder originally used for this download.",
                                    "请选择此下载任务原来使用的目录。",
                                  ),
                                );
                            })
                          }
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
                  <IconButton
                    label={
                      complete || cancelled
                        ? t("Remove record", "移除记录")
                        : t("Cancel transfer", "取消传输")
                    }
                    disabled={changing}
                    onClick={() => void act(j, complete || cancelled ? "remove" : "cancel")}
                  >
                    <Trash2 size={16} />
                  </IconButton>
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
    </section>
  );
}
