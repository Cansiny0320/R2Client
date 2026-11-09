import {
  ChevronDown,
  CalendarDays,
  Clapperboard,
  CloudCog,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Inbox,
  Info,
  Languages,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Share2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  byteLabel,
  downloadConcurrency,
  formatLink,
  objectCategory,
  uploadTuning,
} from "@r2client/core";
import type { Api, Connection, Index, Item, Job, Profile, Schedule } from "@r2client/core";
import { connectionFailure, dateLabel, defaults, Empty, IconButton, Modal } from "./common";
import { MediaRules } from "./media-settings";
import type { Platform, Preferences, Tr } from "./common";
type Run = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;

function useDestinationPath(api: Api, id: string | undefined) {
  const [lookup, setLookup] = useState<{ id: string; path?: string }>();
  useEffect(() => {
    if (id === undefined) return;
    let active = true;
    void api
      .destinationPath(id)
      .then((path) => {
        if (active) setLookup({ id, path });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, id]);
  return lookup?.id === id ? lookup?.path : undefined;
}

function localDateKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value) => String(value).padStart(2, "0"))
    .join("-");
}

export function Statistics({
  p,
  profile,
  index,
  jobs,
  setIndex,
  connected,
  t,
}: {
  p: Platform;
  profile?: Profile;
  index?: Index;
  jobs: Job[];
  setIndex: (v: Index) => void;
  connected: boolean;
  t: Tr;
}) {
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState("");
  async function scan() {
    if (!profile) return;
    setLoading(true);
    setSyncError("");
    try {
      setIndex(await p.api.scan(profile.id));
    } catch (e) {
      setSyncError(connectionFailure(e, t).message);
    } finally {
      setLoading(false);
    }
  }
  const objects = index?.objects.filter((x) => !x.key.endsWith("/")) ?? [],
    used = objects.reduce((a, b) => a + b.size, 0);
  const byType = Map.groupBy(objects, (x) => objectCategory(x.key));
  const typeRows = [...byType]
    .map(([type, group]) => ({
      type,
      count: group.length,
      bytes: group.reduce((a, b) => a + b.size, 0),
    }))
    .sort((a, b) => b.bytes - a.bytes);
  const max = Math.max(1, ...(index?.history.map((h) => h.bytes) ?? []));
  const uploads = Map.groupBy(
    jobs.filter(
      (j) => j.profileId === profile?.id && j.direction === "upload" && j.state === "completed",
    ),
    (job) => localDateKey(new Date(job.updated)),
  );
  const today = new Date();
  const dateBefore = (days: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  const uploadsOn = (date: Date) => uploads.get(localDateKey(date)) ?? [];
  const week = Array.from({ length: 7 }, (_, days) => uploadsOn(dateBefore(days)));
  const recent = Array.from({ length: 30 }, (_, days) => uploadsOn(dateBefore(days)).length);
  const weekTotal = week.reduce((count, day) => count + day.length, 0);
  const weekPeak = Math.max(1, ...week.map((day) => day.length));
  const recentTotal = recent.reduce((total, count) => total + count, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthLength = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const month = Array.from(
    { length: monthLength },
    (_, day) => uploadsOn(new Date(today.getFullYear(), today.getMonth(), day + 1)).length,
  );
  const monthPeak = Math.max(1, ...month);
  const syncButton = (
    <button className="button" disabled={!connected || loading} onClick={() => void scan()}>
      <RefreshCw className={loading ? "spin" : ""} size={15} />
      {loading
        ? t("Syncing…", "正在同步…")
        : syncError
          ? t("Retry sync", "重试同步")
          : t("Sync bucket", "同步存储桶")}
    </button>
  );
  const errorNotice = syncError && (
    <div className="notice error" role="alert">
      {syncError}
    </div>
  );
  return (
    <section
      className="screen-scroll statistics-screen"
      aria-label={t("Storage statistics", "存储统计")}
    >
      {!index ? (
        <div className="screen-empty">
          <Empty
            label={t("Sync a bucket to see its storage statistics", "同步存储桶后查看统计")}
            action={syncButton}
          />
          {errorNotice}
        </div>
      ) : (
        <>
          <div className="metrics">
            <div className="metric">
              <span>{t("Storage overview", "存储概览")}</span>
              <strong>{byteLabel(used)}</strong>
              <small>
                {t("Total", "共")} {objects.length.toLocaleString()} {t("files", "个文件")}
              </small>
              <HardDrive size={24} aria-hidden="true" />
            </div>
          </div>
          <div className="statistics-grid">
            <div className="panel stack">
              <div className="row between wrap gap">
                <h2>{t("Today's upload info", "今日上传信息")}</h2>
                <span className="statistics-badge row gap">
                  <CalendarDays size={12} />
                  {today.toLocaleDateString()}
                </span>
              </div>
              <p className="muted">{t("Uploads from this device", "本机上传记录")}</p>
              <div className="statistics-days">
                {(weekTotal ? week : week.slice(0, 1)).map((day, offset) => (
                  <div className="statistics-day" key={offset}>
                    <strong>
                      {offset === 0
                        ? t("Today", "今天")
                        : offset === 1
                          ? t("Yesterday", "昨天")
                          : t(`${offset} days ago`, `${offset} 天前`)}
                    </strong>
                    <span className="statistics-badge">
                      {day.length} {t("files", "个文件")}
                    </span>
                    <span className="muted">
                      {byteLabel(day.reduce((bytes, job) => bytes + job.total, 0))}
                    </span>
                    <progress
                      max={weekPeak}
                      value={day.length}
                      aria-label={t("Daily uploads", "每日上传量")}
                    />
                  </div>
                ))}
              </div>
              <p className="statistics-week-total">
                {t(
                  `Last 7 days: ${weekTotal} files, daily average ${(weekTotal / 7).toFixed(1)}`,
                  `最近 7 天共上传 ${weekTotal} 个文件，日均 ${(weekTotal / 7).toFixed(1)} 个`,
                )}
              </p>
            </div>
            <div className="panel stack">
              <div className="row between wrap gap">
                <div>
                  <h2>{t("Upload activity", "上传活动")}</h2>
                  <p className="muted">
                    {t(
                      `Last 30 days uploaded ${recentTotal} files`,
                      `最近 30 天上传 ${recentTotal} 个文件`,
                    )}
                  </p>
                </div>
                <div className="row wrap gap">
                  <span className="statistics-badge">
                    {t("Active days", "活跃天数")} · {recent.filter(Boolean).length}
                  </span>
                  <span className="statistics-badge">
                    {t("Daily average", "日均")} · {(recentTotal / 30).toFixed(1)}
                  </span>
                </div>
              </div>
              <div
                className="statistics-calendar"
                role="group"
                aria-label={t("Upload activity this month", "本月上传活动")}
              >
                {Array.from({ length: 7 }, (_, day) => (
                  <span className="muted" key={day}>
                    {new Date(2024, 0, 7 + day).toLocaleDateString(
                      document.documentElement.lang || undefined,
                      { weekday: "short" },
                    )}
                  </span>
                ))}
                {Array.from({ length: monthStart.getDay() }, (_, day) => (
                  <span key={`pad-${day}`} />
                ))}
                {month.map((count, day) => (
                  <div
                    className="statistics-calendar-day"
                    key={`day-${day}`}
                    title={`${day + 1} · ${count} ${t("files", "个文件")}`}
                  >
                    {day + 1}
                    <span data-level={count ? Math.ceil((count / monthPeak) * 4) : 0} />
                  </div>
                ))}
              </div>
              <div className="statistics-calendar-legend">
                {t("Less", "少")}
                {[0, 1, 2, 3, 4].map((level) => (
                  <span key={level} data-level={level} />
                ))}
                {t("More", "多")}
              </div>
            </div>
            <div className="panel stack statistics-sync">
              <div className="row between wrap gap">
                <div>
                  <h2>{t("Sync History", "同步历史")}</h2>
                  <p className="muted">
                    {t("Current bucket", "当前存储桶")} · {dateLabel(index.updated)}
                  </p>
                </div>
                {syncButton}
              </div>
              {errorNotice}
              <div className="result-list statistics-sync-list">
                {[...index.history].reverse().map((h) => (
                  <div className="row between wrap gap" key={h.at}>
                    <span>{dateLabel(h.at)}</span>
                    <span>
                      {h.count} · {byteLabel(h.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <details className="panel stack statistics-sync">
              <summary>{t("Storage details", "存储明细")}</summary>
              <h3>{t("Object types", "文件类型分布")}</h3>
              {typeRows.map((row) => (
                <div className="type-row" key={row.type}>
                  <span>{row.type}</span>
                  <progress max={used || 1} value={row.bytes} />
                  <span>
                    {row.count} · {byteLabel(row.bytes)}
                  </span>
                </div>
              ))}
              {index.history.length > 0 && (
                <>
                  <h3>{t("Storage over time", "存储变化")}</h3>
                  <div className="bars">
                    {index.history.slice(-16).map((h) => (
                      <div key={h.at} title={dateLabel(h.at) + " · " + byteLabel(h.bytes)}>
                        <span style={{ height: Math.max(4, (h.bytes / max) * 100) + "%" }} />
                        <small>{h.at.slice(5, 10)}</small>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </details>
          </div>
        </>
      )}
    </section>
  );
}
export function Extensions({
  p,
  profile,
  connected,
  prefix,
  t,
  run,
  notify,
  changed,
  onObjectsChanged,
}: {
  p: Platform;
  profile?: Profile;
  connected: boolean;
  prefix: string;
  t: Tr;
  run: Run;
  notify: (s: string, error?: boolean, download?: boolean) => void;
  changed: () => Promise<void>;
  onObjectsChanged: () => void;
}) {
  const [scope, setScope] = useState(prefix),
    [groups, setGroups] = useState<Item[][]>(),
    [checked, setChecked] = useState<Set<string>>(new Set()),
    [scanning, setScanning] = useState(false);
  const [extension, setExtension] = useState<"duplicates" | "download">("duplicates");
  const [showScope, setShowScope] = useState(false);
  const [folder, setFolder] = useState(""),
    [schedule, setSchedule] = useState<Schedule>(),
    [minutes, setMinutes] = useState(60),
    [confirm, setConfirm] = useState(false),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [queuing, setQueuing] = useState(false);
  const folderScope = scope.trim().replace(/^\/+|\/+$/g, "");
  const scopePrefix = folderScope ? folderScope + "/" : "";
  const folderPath = useDestinationPath(
    p.api,
    extension === "download" && folder ? folder : undefined,
  );
  const missingPath = t("Please select save path first", "请先选择保存路径");
  useEffect(() => {
    setScope(prefix);
    setGroups(undefined);
    setChecked(new Set());
  }, [profile?.id, prefix]);
  useEffect(() => {
    if (!profile || !p.capabilities.desktop) return;
    let live = true;
    void p.api
      .schedules()
      .then((v) => {
        if (live)
          setSchedule(v.find((s) => s.profileId === profile.id && s.prefix === scopePrefix));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [p, profile?.id, scopePrefix]);
  async function scan() {
    if (!profile) return;
    setScanning(true);
    setGroups(undefined);
    setChecked(new Set());
    const r = await run(() => p.api.duplicates(profile.id, scopePrefix));
    if (r) setGroups(r);
    setScanning(false);
  }
  function toggle(item: Item, group: Item[]) {
    const v = new Set(checked);
    if (v.has(item.key)) v.delete(item.key);
    else if (group.every((x) => x.key === item.key || v.has(x.key)))
      return notify(t("Keep at least one copy in every group", "每组至少保留一个副本"));
    else v.add(item.key);
    setChecked(v);
  }
  async function deleteDuplicates() {
    if (!profile) return;
    const selected = groups?.flat().filter((x) => checked.has(x.key)) ?? [];
    setDeleting(true);
    setDeleteError("");
    try {
      for (const group of groups ?? []) {
        if (!group.some((x) => checked.has(x.key))) continue;
        const survivor = group.find((x) => !checked.has(x.key));
        if (
          !survivor ||
          !survivor.etag ||
          (await p.api.detail(profile.id, survivor.key)).etag !== survivor.etag
        )
          throw new Error(
            t(
              "A retained copy changed. Scan again before deleting.",
              "要保留的副本已变化，请重新扫描后再删除。",
            ),
          );
      }
      const r = await p.api.mutate(
        profile.id,
        selected.map((x) => ({ kind: "delete", key: x.key, expectedEtag: x.etag })),
      );
      const ok = new Set(r.filter((x) => x.ok).map((x) => x.key));
      if (ok.size) onObjectsChanged();
      setGroups(groups?.map((g) => g.filter((x) => !ok.has(x.key))).filter((g) => g.length > 1));
      setChecked(new Set());
      setConfirm(false);
      const failed = r.find((x) => !x.ok);
      notify(
        ok.size +
          " " +
          t("deleted", "项已删除") +
          (failed
            ? " · " + (r.length - ok.size) + " " + t("failed", "项失败") + " · " + failed.error
            : ""),
      );
    } catch (e) {
      setDeleteError(connectionFailure(e, t).message);
    } finally {
      setDeleting(false);
    }
  }
  async function sync() {
    if (!profile) return;
    if (!folder) {
      notify(missingPath, true, true);
      return;
    }
    setQueuing(true);
    try {
      await run(async () => {
        const n = await p.api.syncDirectory(profile.id, scopePrefix, folder);
        await changed();
        notify(n + " " + t("files queued", "个文件已排队"));
      });
    } finally {
      setQueuing(false);
    }
  }
  async function plan(enabled: boolean) {
    if (!profile) return;
    await run(
      async () => {
        const dir = folder || schedule?.destination || (await p.api.pickDestination());
        if (!dir) return;
        const entry = {
          profileId: profile.id,
          prefix: scopePrefix,
          destination: dir,
          minutes,
          enabled,
        };
        await p.api.schedule(entry);
        setSchedule(entry);
        setFolder(dir);
      },
      t("Schedule saved", "同步计划已保存"),
    );
  }
  const scopeField = (
    <label className="field-narrow">
      {t("Folder scope", "目录范围")}
      <input
        value={scope}
        disabled={scanning || deleting || queuing}
        onChange={(e) => {
          setScope(e.target.value);
          setSchedule(undefined);
          setGroups(undefined);
          setChecked(new Set());
        }}
        placeholder={t("Entire bucket", "整个存储桶")}
      />
    </label>
  );
  const selectedBytes =
    groups?.reduce(
      (total, group) =>
        total + group.reduce((bytes, item) => bytes + (checked.has(item.key) ? item.size : 0), 0),
      0,
    ) ?? 0;
  const scanLabel = scanning ? t("Scanning…", "扫描中…") : t("Scan Duplicates", "扫描重复文件");
  const startScan = () => {
    setShowScope(false);
    void scan();
  };
  return (
    <section className="screen-scroll extensions-screen">
      <div className="filter-tabs" role="group" aria-label={t("Extensions", "扩展功能")}>
        <button
          type="button"
          className={extension === "duplicates" ? "selected" : ""}
          aria-pressed={extension === "duplicates"}
          onClick={() => setExtension("duplicates")}
        >
          {t("Duplicate Files", "重复文件")}
        </button>
        <button
          type="button"
          className={extension === "download" ? "selected" : ""}
          aria-pressed={extension === "download"}
          onClick={() => setExtension("download")}
        >
          {t("Bucket Download", "存储桶下载")}
        </button>
      </div>
      {extension === "duplicates" && (
        <>
          <div className="row between wrap gap extension-toolbar">
            <div className="row wrap extension-scope-summary muted">
              <span>
                {groups?.length ?? 0} {t("duplicate groups", "组重复文件")}
              </span>
              <span>
                {checked.size} {t("selected", "项已选")} (
                {byteLabel(selectedBytes).replace(" ", "")})
              </span>
              {folderScope && <span>{folderScope}</span>}
            </div>
            <div className="row wrap gap">
              {checked.size > 0 && (
                <button
                  className="button danger duplicate-delete"
                  onClick={() => {
                    setDeleteError("");
                    setConfirm(true);
                  }}
                >
                  {t("Delete Selected", "删除所选")}
                </button>
              )}
              <div
                className="scan-controls"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setShowScope(false);
                }}
              >
                <button
                  className="button primary"
                  disabled={!connected || scanning}
                  onClick={startScan}
                >
                  {scanLabel}
                </button>
                <IconButton
                  label={t("Filter by folder", "按目录筛选")}
                  aria-expanded={showScope}
                  aria-controls="duplicate-scope"
                  onClick={() => setShowScope(!showScope)}
                >
                  <ChevronDown size={15} />
                </IconButton>
                <div id="duplicate-scope" className="extension-scope-field" hidden={!showScope}>
                  {scopeField}
                </div>
              </div>
            </div>
          </div>
          {groups?.length ? (
            <div className="duplicate-results">
              {groups.map((group) => {
                const dated = group
                  .map((item) => item.modified)
                  .filter(Boolean)
                  .sort();
                const firstDate = dated[0];
                const lastDate = dated.at(-1);
                const size = group.reduce((total, item) => total + item.size, 0);
                const hasSelection = group.some((item) => checked.has(item.key));
                return (
                  <details className="duplicate-group" key={group[0]!.key}>
                    <summary>
                      <span>
                        <strong>{t("Same Files Group", "相同文件组")}</strong>
                        <small>
                          {group.length} {t("members", "个文件")} ·{" "}
                          {byteLabel(size).replace(" ", "")}
                          {firstDate &&
                            lastDate &&
                            " · " +
                              new Date(firstDate).toLocaleString() +
                              " ~ " +
                              new Date(lastDate).toLocaleString()}
                        </small>
                      </span>
                      <ChevronDown size={16} aria-hidden="true" />
                    </summary>
                    <div className="duplicate-table-scroll">
                      <table aria-label={t("Duplicate files", "重复文件")}>
                        <thead>
                          <tr>
                            <th scope="col">{t("Del", "删除")}</th>
                            <th scope="col">{t("File Name", "文件名")}</th>
                            <th scope="col">{t("Size", "大小")}</th>
                            <th scope="col">{t("Upload Time", "上传时间")}</th>
                            <th scope="col">MIME</th>
                            <th scope="col">{t("Keep", "保留")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.map((item) => (
                            <tr
                              key={item.key}
                              className={
                                hasSelection && !checked.has(item.key) ? "retained" : undefined
                              }
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={item.key}
                                  checked={checked.has(item.key)}
                                  onChange={() => toggle(item, group)}
                                />
                              </td>
                              <td>
                                <code title={item.key}>{item.key}</code>
                              </td>
                              <td>{byteLabel(item.size).replace(" ", "")}</td>
                              <td>
                                {item.modified ? new Date(item.modified).toLocaleString() : "—"}
                              </td>
                              <td className="muted">{item.type || "—"}</td>
                              <td className="duplicate-keep">
                                {hasSelection && !checked.has(item.key) && t("Keep", "保留")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="screen-empty extension-empty">
              <Empty
                icon={<Inbox size={25} aria-hidden="true" />}
                label={
                  groups
                    ? t("No duplicate content found", "没有发现内容相同的文件")
                    : t("No Data Yet", "暂无数据")
                }
                description={
                  !groups
                    ? t(
                        "Click “Scan Duplicates” to find duplicate files. You can limit the scan to a folder in the dropdown.",
                        "点击扫描查找重复文件，可在下拉菜单中限制目录范围。",
                      )
                    : undefined
                }
                action={
                  !groups && (
                    <button
                      className="button primary"
                      disabled={!connected || scanning}
                      onClick={startScan}
                    >
                      {scanLabel}
                    </button>
                  )
                }
              />
            </div>
          )}
        </>
      )}
      {extension === "download" && (
        <div className="panel stack extension-panel bucket-download-panel">
          <header className="bucket-download-header">
            <div className="row between wrap gap">
              <h2>{t("Bucket Download", "存储桶下载")}</h2>
              {connected && (
                <span className="status-pill">
                  {queuing ? t("Preparing", "准备中") : t("Ready", "就绪")}
                </span>
              )}
            </div>
            <p className="muted">
              {t("Download bucket contents to a local folder.", "将存储桶文件下载到本地目录。")}
            </p>
          </header>
          <div className="row wrap gap bucket-download-path">
            <label>
              {t("Select Save Path", "选择保存路径")}
              <input
                className="settings-path-value"
                value={folderPath ?? ""}
                readOnly
                placeholder={
                  folder
                    ? t("Folder selected", "已选择目录")
                    : missingPath
                }
                title={folderPath}
              />
            </label>
            {p.capabilities.folders && (
              <button
                className="button"
                disabled={queuing}
                onClick={() =>
                  void run(async () => {
                    const d = await p.api.pickDestination();
                    if (d) setFolder(d);
                  })
                }
              >
                <FolderOpen size={16} /> {t("Select Folder", "选择目录")}
              </button>
            )}
          </div>
          <div className="bucket-download-scope">{scopeField}</div>
          <div className="bucket-download-actions">
            <button
              className="button primary"
              disabled={!connected || !p.capabilities.folders || queuing}
              onClick={() => void sync()}
            >
              <Download size={16} />
              {queuing
                ? t("Preparing download…", "正在准备下载…")
                : t("Start Download", "开始下载")}
            </button>
          </div>
          {p.capabilities.desktop && (
            <div className="row gap wrap">
              <label>
                {t("Run every (minutes)", "运行间隔（分钟）")}
                <input
                  type="number"
                  min="5"
                  max="10080"
                  value={minutes}
                  onChange={(e) => setMinutes(+e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={!connected || queuing}
                onClick={() => void plan(true)}
              >
                {t("Enable schedule", "启用定时同步")}
              </button>
              {schedule?.enabled && (
                <button className="button" onClick={() => void plan(false)}>
                  {t("Disable schedule", "停用定时同步")} · {schedule.minutes}m
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {confirm && (
        <Modal
          open
          title={t("Delete duplicate copies", "删除重复副本")}
          onClose={() => {
            if (!deleting) setConfirm(false);
          }}
        >
          <div className="dialog-body stack">
            <div className="notice error">
              {checked.size} {t("objects will be permanently deleted.", "个对象将永久删除。")}
            </div>
            {deleteError && (
              <div className="notice error" role="alert">
                {deleteError}
              </div>
            )}
            <div className="row end gap">
              <button className="button" disabled={deleting} onClick={() => setConfirm(false)}>
                {t("Cancel", "取消")}
              </button>
              <button
                className="button danger"
                disabled={deleting}
                onClick={() => void deleteDuplicates()}
              >
                {t("Delete", "删除")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function ConnectionModal({
  p,
  profile,
  t,
  close,
  saved,
}: {
  p: Platform;
  profile?: Profile;
  t: Tr;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(profile?.label ?? ""),
    [account, setAccount] = useState(profile?.accountId ?? ""),
    [bucket, setBucket] = useState(profile?.bucket ?? "");
  const [access, setAccess] = useState(""),
    [secret, setSecret] = useState(""),
    [session, setSession] = useState(""),
    [base, setBase] = useState(profile?.publicBase ?? "");
  const [region, setRegion] = useState<Connection["jurisdiction"]>(
      profile?.jurisdiction ?? "default",
    ),
    [remember, setRemember] = useState(p.capabilities.desktop);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = (
    <form
      className="dialog-body stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await p.api.connect({
            id: profile?.id ?? "",
            label: label.trim() || bucket,
            accountId: account,
            bucket,
            jurisdiction: region,
            publicBase: base,
            remember,
            credentials: {
              accessKeyId: access,
              secretAccessKey: secret,
              sessionToken: session || undefined,
            },
          });
          await saved();
          close();
        } catch (e) {
          setError(connectionFailure(e, t).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {t("Display name", "显示名称")}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="my-assets"
          autoComplete="off"
        />
      </label>
      <label>
        Cloudflare Account ID
        <input
          required
          value={account}
          readOnly={!!profile}
          onChange={(e) => setAccount(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="form-columns">
        <label>
          {t("Bucket name", "存储桶名称")}
          <input
            required
            value={bucket}
            readOnly={!!profile}
            onChange={(e) => setBucket(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          {t("Jurisdiction", "数据管辖区")}
          <select
            disabled={!!profile}
            value={region}
            onChange={(e) => setRegion(e.target.value as typeof region)}
          >
            <option value="default">{t("Default", "默认")}</option>
            <option value="eu">EU</option>
            <option value="fedramp">FedRAMP</option>
          </select>
        </label>
      </div>
      <label>
        Access Key ID
        <input
          required={!profile}
          value={access}
          onChange={(e) => setAccess(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label>
        Secret Access Key
        <input
          required={!profile}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <details>
        <summary>{t("Temporary credentials or public URL", "临时凭据或公开链接")}</summary>
        <div className="stack detail-fields">
          <label>
            Session token
            <input
              type="password"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            {t("Public URL", "公开访问域名")}
            <input
              type="url"
              placeholder="https://cdn.example.com"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </label>
        </div>
      </details>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{" "}
        {t("Remember credentials on this device", "在此设备上记住凭据")}
      </label>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="row end gap">
        <button type="button" className="button" onClick={close}>
          {t("Cancel", "取消")}
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? t("Connecting…", "正在连接…") : t("Connect", "连接", "接続", "연결")}
        </button>
      </div>
    </form>
  );
  return (
    <Modal
      open
      title={
        profile
          ? t("Edit storage bucket", "编辑存储桶")
          : t("Add storage bucket", "添加存储桶", "バケットを追加", "버킷 추가")
      }
      onClose={close}
    >
      {form}
    </Modal>
  );
}
function SettingsHeading({
  id,
  icon,
  title,
  description,
  action,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="settings-section-heading">
      <span className="settings-heading-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

type SettingsTab =
  | "buckets"
  | "appearance"
  | "language"
  | "upload"
  | "download"
  | "sharing"
  | "about";

export function SettingsPanel({
  p,
  appVersion,
  prefs,
  set,
  t,
  close,
  profiles,
  edit,
  remove,
  add,
  run,
}: {
  p: Platform;
  appVersion: string;
  prefs: Preferences;
  set: (o: Partial<Preferences>) => void;
  t: Tr;
  close: () => void;
  profiles: Profile[];
  edit: (profile: Profile) => void;
  remove: (profile: Profile) => void;
  add: () => void;
  run: Run;
}) {
  const [tab, setTab] = useState<SettingsTab>("buckets"),
    [ffmpeg, setFFmpeg] = useState<{ available: boolean; executable?: string }>();
  const showingDownload = tab === "download" && p.capabilities.desktop;
  const systemDownloadPath = useDestinationPath(p.api, showingDownload ? "" : undefined);
  const customDownloadPath = useDestinationPath(
    p.api,
    showingDownload && prefs.downloadFolder ? prefs.downloadFolder : undefined,
  );
  const downloadPath = prefs.downloadFolder ? customDownloadPath : systemDownloadPath;
  const tabs = [
    ["buckets", t("Buckets", "存储桶设置", "バケット", "버킷"), CloudCog],
    ["appearance", t("Layout", "布局设置", "レイアウト", "레이아웃"), LayoutGrid],
    ["language", t("Language", "语言设置", "言語", "언어"), Languages],
    ["upload", t("Upload", "上传设置", "アップロード", "업로드"), UploadCloud],
    ["download", t("Download", "下载设置", "ダウンロード", "다운로드"), Download],
    ["sharing", t("Sharing", "分享设置", "共有", "공유"), Share2],
    ["about", t("About", "关于软件", "情報", "정보"), Info],
  ] as const;
  const [, navTitle, SectionIcon] = tabs.find(([id]) => id === tab) ?? tabs[0];
  const heading =
    tab === "buckets"
      ? t("Buckets", "存储桶")
      : tab === "upload"
        ? t("Media Processing Engine", "多媒体处理引擎")
        : tab === "download"
          ? t("Download Settings", "下载设置")
          : tab === "about"
            ? t("About R2Client", "关于 R2Client")
            : navTitle;
  const descriptions: Record<SettingsTab, string> = {
    buckets: t("Manage your storage buckets.", "管理已连接的存储桶。"),
    appearance: t("Customize the default view and interface.", "自定义默认视图和界面。"),
    language: t(
      "Choose your UI language. Changes apply instantly.",
      "选择偏好的界面语言，立即生效。",
    ),
    upload: t(
      "FFmpeg powers desktop audio and video conversion.",
      "桌面端使用 FFmpeg 完成音视频转码。",
    ),
    download: t(
      "Configure default download path. Changes are auto-saved. If not set, the system default download folder will be used.",
      "配置默认下载路径，选择后自动保存。未设置时使用系统默认下载文件夹。",
    ),
    sharing: t("Choose the default format for copying links.", "选择复制链接的默认格式。"),
    about: t("View application version information.", "查看应用版本信息。"),
  };
  const reset = (
    patch: Partial<Preferences>,
    label = t("Reset", "重置"),
    disabled = false,
    ariaLabel?: string,
  ) => (
    <button
      type="button"
      className="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => set(patch)}
    >
      <RotateCcw size={15} /> {label}
    </button>
  );
  const headingActions: Partial<Record<SettingsTab, ReactNode>> = {
    appearance: reset({ theme: defaults.theme, zoom: defaults.zoom, view: defaults.view }),
    language: reset(
      { language: defaults.language },
      t("Restore default", "恢复默认"),
      prefs.language === defaults.language,
    ),
    upload: p.capabilities.desktop && (
      <button
        type="button"
        className="button"
        onClick={() => void run(async () => setFFmpeg(await p.api.ffmpegStatus()))}
      >
        {t("Detect again", "重新检测")}
      </button>
    ),
    download: reset(
      { downloadFolder: "" },
      t("Reset", "重置"),
      !prefs.downloadFolder,
      t("Reset to system Downloads folder", "重置为系统下载目录"),
    ),
    sharing: reset({ shareFormat: defaults.shareFormat }),
  };
  const languages = [
    ["en", "English", "🇺🇸"],
    ["ja", "日本語", "🇯🇵"],
    ["zh", "中文", "🇨🇳"],
    ["ko", "한국어", "🇰🇷"],
  ] as const;
  const [, selectedLanguage, selectedFlag] =
    languages.find(([code]) => code === prefs.language) ?? languages[0];
  useEffect(() => {
    if (tab === "upload")
      void p.api
        .ffmpegStatus()
        .then(setFFmpeg)
        .catch(() => {});
  }, [p, tab]);
  return (
    <Modal
      title={t("Settings", "设置", "設定", "설정")}
      open
      onClose={close}
      backLabel={t("Back", "返回")}
    >
      <div className="settings-layout">
        <nav aria-label={t("Settings sections", "设置分类")}>
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "current" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <section className="stack settings-content" aria-labelledby="settings-section-title">
          <SettingsHeading
            id="settings-section-title"
            icon={tab === "upload" ? <Clapperboard size={20} /> : <SectionIcon size={20} />}
            title={heading}
            description={descriptions[tab]}
            action={headingActions[tab]}
          />
          {tab === "buckets" && (
            <div className="panel stack settings-group">
              <button className="button primary" onClick={add}>
                <Plus size={16} /> {t("Add storage bucket", "添加存储桶")}
              </button>
              {profiles.map((profile) => (
                <div className="settings-bucket" key={profile.id}>
                  <span className="settings-bucket-icon" aria-hidden="true">
                    <Database size={20} />
                  </span>
                  <div className="stack">
                    <strong>{profile.label}</strong>
                    <small className="muted">
                      {profile.demo
                        ? t("Demo", "示例")
                        : profile.publicBase
                          ? t("Public", "公开")
                          : t("Private", "私有")}
                    </small>
                  </div>
                  <div className="row gap settings-bucket-actions">
                    {!profile.demo && (
                      <IconButton
                        label={t("Edit", "编辑") + " · " + profile.label}
                        onClick={() => edit(profile)}
                      >
                        <Pencil size={16} />
                      </IconButton>
                    )}
                    <IconButton
                      className="danger-text"
                      label={t("Remove", "移除") + " · " + profile.label}
                      onClick={() => remove(profile)}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "appearance" && (
            <>
              <div className="panel settings-group form-columns">
                <label>
                  {t("Theme", "主题", "テーマ", "테마")}
                  <select
                    value={prefs.theme}
                    onChange={(e) => set({ theme: e.target.value as Preferences["theme"] })}
                  >
                    <option value="system">{t("System", "跟随系统")}</option>
                    <option value="light">{t("Light", "浅色")}</option>
                    <option value="dark">{t("Dark", "深色")}</option>
                  </select>
                </label>
                <label>
                  {t("Default view", "默认视图")}
                  <select
                    value={prefs.view}
                    onChange={(e) => set({ view: e.target.value as Preferences["view"] })}
                  >
                    <option value="grid">{t("Grid", "网格")}</option>
                    <option value="list">{t("List", "列表")}</option>
                  </select>
                </label>
                <label className="settings-wide-field">
                  {t("Interface scale", "界面缩放")} · {prefs.zoom}%
                  <input
                    type="range"
                    min="85"
                    max="125"
                    step="5"
                    value={prefs.zoom}
                    onChange={(e) => set({ zoom: +e.target.value })}
                  />
                </label>
              </div>
              <SettingsHeading
                icon={<List size={20} />}
                title={t("File list display", "文件列表显示")}
                description={t(
                  "Customize how many files and thumbnails are shown.",
                  "自定义默认加载数量和缩略图。",
                )}
                action={reset({ pageSize: defaults.pageSize, preview: defaults.preview })}
              />
              <div className="panel settings-group form-columns">
                <label className="settings-wide-field">
                  {t("Default page size", "默认加载数量")}
                  <select
                    value={prefs.pageSize}
                    onChange={(e) => set({ pageSize: +e.target.value as Preferences["pageSize"] })}
                  >
                    {[25, 50, 100, 200].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.preview}
                    onChange={(e) => set({ preview: e.target.checked })}
                  />{" "}
                  {t("Image thumbnails", "显示图片缩略图")}
                </label>
              </div>
            </>
          )}
          {tab === "language" && (
            <div className="panel stack settings-group">
              <div className="row between wrap gap">
                <h3 className="settings-inline-heading">
                  <Languages size={16} aria-hidden="true" /> {t("UI language", "界面语言")}
                </h3>
                <span className="settings-current-language">
                  <span aria-hidden="true">{selectedFlag}</span> {selectedLanguage}
                </span>
              </div>
              <fieldset className="settings-choice-grid settings-languages">
                <legend className="sr-only">{t("UI language", "界面语言")}</legend>
                {languages.map(([value, label, flag]) => (
                  <label key={value}>
                    <input
                      className="sr-only"
                      type="radio"
                      name="interface-language"
                      checked={prefs.language === value}
                      onChange={() => set({ language: value })}
                    />
                    <span className="language-symbol" aria-hidden="true">
                      {flag}
                    </span>
                    <strong>{label}</strong>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          {tab === "upload" && (
            <>
              {p.capabilities.desktop && (
                <div className="panel stack settings-group">
                  <div className="row between wrap gap">
                    <h3 className="settings-inline-heading">{t("FFmpeg status", "FFmpeg 状态")}</h3>
                    <span className={"status-pill" + (ffmpeg?.available ? " ffmpeg-enabled" : "")}>
                      {ffmpeg?.available ? t("Enabled", "已启用") : t("Not configured", "未配置")}
                    </span>
                  </div>
                  {ffmpeg?.executable && (
                    <code className="settings-path-value">{ffmpeg.executable}</code>
                  )}
                  <button
                    className="button primary"
                    onClick={() =>
                      void run(async () => {
                        await p.api.configureFfmpeg();
                        setFFmpeg(await p.api.ffmpegStatus());
                      })
                    }
                  >
                    <FolderOpen size={16} /> {t("Choose executable", "选择程序")}
                  </button>
                </div>
              )}
              <SettingsHeading
                icon={<UploadCloud size={20} />}
                title={t("Media Upload Processing", "多媒体上传处理")}
                description={t(
                  "Set default processing for images, audio, and video.",
                  "为图片、音频和视频设置默认上传处理方式。",
                )}
                action={reset({ media: defaults.media })}
              />
              <div className="panel stack settings-group settings-media">
                <MediaRules value={prefs.media} set={(media) => set({ media })} t={t} />
              </div>
              <SettingsHeading
                icon={<UploadCloud size={20} />}
                title={t("Upload Concurrency & Chunking", "上传并发与分片")}
                description={t(
                  "Adjust concurrent uploads and part sizes.",
                  "调节同时上传的文件数量与分片策略。",
                )}
              />
              <div className="panel settings-group form-columns">
                {(
                  [
                    ["files", t("Parallel file uploads", "文件上传并发数"), 1, 16],
                    [
                      "thresholdMiB",
                      t("Multipart threshold (MiB)", "分片上传阈值（MiB）"),
                      prefs.uploadTuning.chunkMiB,
                      512,
                    ],
                    ["chunkMiB", t("Part size (MiB)", "分片大小（MiB）"), 5, 128],
                    ["perFile", t("Parallel parts per file", "单文件分片并发数"), 1, 16],
                    ["global", t("Total concurrent uploads", "全局上传并发数"), 1, 32],
                  ] as const
                ).map(([field, label, min, max]) => (
                  <label key={field}>
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={prefs.uploadTuning[field]}
                      onChange={(e) =>
                        set({
                          uploadTuning: uploadTuning({
                            ...prefs.uploadTuning,
                            [field]: e.target.valueAsNumber,
                          }),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <SettingsHeading
                icon={<UploadCloud size={20} />}
                title={t("More upload settings", "更多上传设置")}
              />
              <div className="panel settings-group form-columns">
                <label>
                  {t("Refresh files every (minutes, 0 disables)", "自动刷新（分钟，0 表示关闭）")}
                  <input
                    type="number"
                    min="0"
                    max="1440"
                    value={prefs.autoRefresh}
                    onChange={(e) =>
                      set({ autoRefresh: Math.max(0, Math.min(1440, +e.target.value || 0)) })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.replace}
                    onChange={(e) => set({ replace: e.target.checked })}
                  />
                  {t("Replace files with the same name by default", "默认替换同名文件")}
                </label>
              </div>
            </>
          )}
          {tab === "download" && (
            <>
              <div className="panel stack settings-group">
                <h3 className="settings-inline-heading">
                  <FolderOpen size={16} aria-hidden="true" />{" "}
                  {t("Current Download Path", "当前下载路径")}
                </h3>
                <div className="settings-destination">
                  <input
                    className="settings-path-value"
                    aria-label={t("Current download path", "当前下载路径")}
                    readOnly
                    value={downloadPath ?? ""}
                    placeholder={
                      prefs.downloadFolder
                        ? t("Selected folder", "已选择目录")
                        : t("System Downloads folder", "系统默认下载目录")
                    }
                    title={downloadPath}
                  />
                  <IconButton
                    label={t("Choose folder", "选择文件夹")}
                    onClick={() =>
                      void run(async () => {
                        const folder = await p.api.pickDestination();
                        if (folder) set({ downloadFolder: folder });
                      })
                    }
                  >
                    <FolderOpen size={16} />
                  </IconButton>
                </div>
              </div>
              {(systemDownloadPath || prefs.downloadFolder) && (
                <div className="settings-download-note row between wrap gap">
                  {systemDownloadPath && (
                    <span className="row gap">
                      <Info size={14} aria-hidden="true" />
                      {t("System default path:", "系统默认路径：")}{" "}
                      <code className="settings-path-value">{systemDownloadPath}</code>
                    </span>
                  )}
                  {prefs.downloadFolder && (
                    <button
                      className="button ghost"
                      onClick={() => void run(() => p.api.revealDestination(prefs.downloadFolder))}
                    >
                      {t("Open folder", "打开目录")}
                    </button>
                  )}
                </div>
              )}
              <SettingsHeading
                icon={<Download size={20} />}
                title={t("Download behavior", "下载行为")}
              />
              <div className="panel settings-group form-columns">
                <label>
                  {t("When download completes", "下载完成后的操作")}
                  <select
                    value={prefs.downloadCompletion}
                    onChange={(e) =>
                      set({
                        downloadCompletion: e.target.value as Preferences["downloadCompletion"],
                      })
                    }
                  >
                    <option value="notify">{t("Show notification", "显示通知")}</option>
                    <option value="reveal">{t("Show in folder", "在文件夹中显示")}</option>
                    <option value="none">{t("Do nothing", "无操作")}</option>
                  </select>
                </label>
                <label>
                  {t("Parallel downloads", "下载并发数")}
                  <input
                    type="number"
                    min="1"
                    max="16"
                    value={prefs.downloadParallel}
                    onChange={(e) =>
                      set({ downloadParallel: downloadConcurrency(e.target.valueAsNumber) })
                    }
                  />
                </label>
              </div>
            </>
          )}
          {tab === "sharing" && (
            <>
              <fieldset className="settings-choice-grid settings-formats">
                <legend className="sr-only">{t("Default link format", "默认链接格式")}</legend>
                {(
                  [
                    [
                      "url",
                      t("Original link", "原始链接"),
                      t(
                        "Use the object address directly for a CDN or shared download.",
                        "直接使用对象地址，适用于 CDN 或共享下载。",
                      ),
                    ],
                    [
                      "markdown",
                      "Markdown",
                      t(
                        "For knowledge bases, forum posts, and documents.",
                        "适用于知识库、论坛贴文或文档协作。",
                      ),
                    ],
                    [
                      "html",
                      "HTML",
                      t(
                        "Embed it in a web page with alternative text.",
                        "可直接嵌入网页，支持 alt 文本。",
                      ),
                    ],
                    [
                      "bbcode",
                      "BBCode",
                      t(
                        "For forums and communities that use BBCode.",
                        "兼容传统论坛或社区贴文格式。",
                      ),
                    ],
                  ] as const
                ).map(([value, label, description]) => (
                  <label key={value}>
                    <span className="settings-format-heading">
                      <input
                        type="radio"
                        name="link-format"
                        aria-label={label}
                        checked={prefs.shareFormat === value}
                        onChange={() => set({ shareFormat: value })}
                      />
                      <span>
                        <strong>{label}</strong>
                        <span className="settings-format-description">{description}</span>
                      </span>
                    </span>
                    <span className="settings-format-preview">
                      <span>{t("Preview", "预览示例")}</span>
                      <code>
                        {formatLink(
                          "https://example.com/path/to/file.jpg",
                          "example-file.jpg",
                          value,
                        )}
                      </code>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label>
                {t("Password share service URL", "密码分享服务 URL")}
                <input
                  type="url"
                  placeholder="https://share.example.com"
                  value={prefs.shareServer}
                  onChange={(e) => set({ shareServer: e.target.value })}
                />
              </label>
            </>
          )}
          {tab === "about" && (
            <div className="panel stack settings-group">
              <div className="settings-about-name">
                <strong>R2Client</strong>
                <code>v{appVersion}</code>
              </div>
              <span className="subtle">
                MIT ·{" "}
                {t("Independent open-source Cloudflare R2 client", "独立开源 Cloudflare R2 客户端")}
              </span>
              <button
                className="button primary settings-about-link"
                onClick={() => void p.api.openExternal("https://github.com/Cansiny0320/R2Client")}
              >
                GitHub
              </button>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
