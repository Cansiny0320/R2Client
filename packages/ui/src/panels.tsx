import {
  BarChart3,
  Database,
  DownloadCloud,
  Files as FileCount,
  FolderOpen,
  HardDrive,
  RefreshCw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { byteLabel, downloadConcurrency, objectCategory, uploadTuning } from "@r2client/core";
import type { Connection, Index, Item, Job, Profile, Schedule } from "@r2client/core";
import { connectionFailure, dateLabel, Empty, Modal } from "./common";
import { MediaRules } from "./media-settings";
import type { Platform, Preferences, Tr } from "./common";
type Run = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;

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
    (x) => x.updated.slice(0, 10),
  );
  const dates = [...uploads.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  const maxDaily = Math.max(1, ...dates.map(([, v]) => v.length));
  return (
    <section className="screen-scroll">
      <header className="screen-header">
        <div>
          <h1>{t("Storage statistics", "存储统计", "ストレージ統計", "저장소 통계")}</h1>
          <p>{profile?.label ?? "—"}</p>
        </div>
        <button
          className="button primary"
          disabled={!connected || loading}
          onClick={() => void scan()}
        >
          <RefreshCw className={loading ? "spin" : ""} size={15} />{" "}
          {loading
            ? t("Syncing…", "正在同步…")
            : syncError
              ? t("Retry sync", "重试同步")
              : t("Sync bucket", "同步存储桶")}
        </button>
      </header>
      {syncError && (
        <div className="notice error" role="alert">
          {syncError}
        </div>
      )}
      {!index ? (
        <Empty label={t("Sync a bucket to see its storage statistics", "同步存储桶后查看统计")} />
      ) : (
        <>
          <div className="metrics">
            <div className="metric">
              <HardDrive size={19} />
              <span>{t("Storage used", "已用空间")}</span>
              <strong>{byteLabel(used)}</strong>
            </div>
            <div className="metric">
              <FileCount size={19} />
              <span>{t("Objects", "对象数")}</span>
              <strong>{objects.length.toLocaleString()}</strong>
            </div>
            <div className="metric">
              <Database size={19} />
              <span>{t("Last synced", "上次同步")}</span>
              <strong className="metric-date">{dateLabel(index.updated)}</strong>
            </div>
          </div>
          <div className="statistics-grid">
            <div className="panel stack">
              <h2>{t("Object types", "文件类型分布")}</h2>
              {typeRows.map((row) => (
                <div className="type-row" key={row.type}>
                  <span>{row.type}</span>
                  <progress max={used || 1} value={row.bytes} />
                  <span>
                    {row.count} · {byteLabel(row.bytes)}
                  </span>
                </div>
              ))}
            </div>
            <div className="panel stack">
              <h2>{t("Storage over time", "存储变化")}</h2>
              <div className="bars">
                {index.history.slice(-16).map((h) => (
                  <div key={h.at} title={dateLabel(h.at) + " · " + byteLabel(h.bytes)}>
                    <span style={{ height: Math.max(4, (h.bytes / max) * 100) + "%" }} />
                    <small>{h.at.slice(5, 10)}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel stack">
              <h2>
                {t(
                  "Uploads from this device",
                  "本机上传趋势",
                  "この端末からのアップロード",
                  "이 기기에서 업로드",
                )}
              </h2>
              <div className="bars">
                {dates.map(([date, items]) => (
                  <div key={date} title={date + " · " + items.length}>
                    <span style={{ height: Math.max(4, (items.length / maxDaily) * 100) + "%" }} />
                    <small>{date.slice(5)}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel stack">
              <h2>{t("Sync snapshots", "同步记录")}</h2>
              <div className="result-list">
                {[...index.history].reverse().map((h) => (
                  <div className="row between" key={h.at}>
                    <span>{dateLabel(h.at)}</span>
                    <span>
                      {h.count} · {byteLabel(h.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
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
}: {
  p: Platform;
  profile?: Profile;
  connected: boolean;
  prefix: string;
  t: Tr;
  run: Run;
  notify: (s: string) => void;
  changed: () => Promise<void>;
}) {
  const [scope, setScope] = useState(prefix),
    [groups, setGroups] = useState<Item[][]>(),
    [checked, setChecked] = useState<Set<string>>(new Set()),
    [scanning, setScanning] = useState(false);
  const [extension, setExtension] = useState<"duplicates" | "download">("duplicates");
  const [folder, setFolder] = useState(""),
    [schedule, setSchedule] = useState<Schedule>(),
    [minutes, setMinutes] = useState(60),
    [confirm, setConfirm] = useState(false),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [queuing, setQueuing] = useState(false);
  const folderScope = scope.trim().replace(/^\/+|\/+$/g, "");
  const scopePrefix = folderScope ? folderScope + "/" : "";
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
    setQueuing(true);
    try {
      await run(async () => {
        const dir = folder || (await p.api.pickDestination());
        if (!dir) return;
        setFolder(dir);
        const n = await p.api.syncDirectory(profile.id, scopePrefix, dir);
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
  return (
    <section className="screen-scroll">
      <header className="screen-header">
        <div>
          <h1>{t("Extensions", "扩展功能", "拡張機能", "확장 기능")}</h1>
          <p>{profile?.label ?? "—"}</p>
        </div>
      </header>
      <div className="filter-tabs" aria-label={t("Extensions", "扩展功能")}>
        <button
          type="button"
          className={"button " + (extension === "duplicates" ? "selected" : "")}
          aria-pressed={extension === "duplicates"}
          onClick={() => setExtension("duplicates")}
        >
          {t("Duplicate files", "重复文件")}
        </button>
        <button
          type="button"
          className={"button " + (extension === "download" ? "selected" : "")}
          aria-pressed={extension === "download"}
          onClick={() => setExtension("download")}
        >
          {t("Bucket download", "存储桶下载")}
        </button>
      </div>
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
      {extension === "duplicates" && (
        <div className="panel stack extension-panel">
          <div className="row between wrap gap">
            <h2 className="row gap">
              <ScanSearch size={20} /> {t("Find duplicates", "文件去重")}
            </h2>
            <button
              className="button primary"
              disabled={!connected || scanning}
              onClick={() => void scan()}
            >
              <ScanSearch size={15} />{" "}
              {scanning ? t("Scanning…", "扫描中…") : t("Scan by content", "按内容扫描")}
            </button>
          </div>
          {groups && !groups.length && (
            <div className="subtle">
              {t("No duplicate content found", "没有发现内容相同的文件")}
            </div>
          )}
          {groups?.map((group, i) => (
            <div className="duplicate-group" key={i}>
              <strong>
                {group.length} {t("identical files", "个相同文件")} · {byteLabel(group[0]!.size)}
              </strong>
              {group.map((item) => (
                <label key={item.key} className="check">
                  <input
                    type="checkbox"
                    checked={checked.has(item.key)}
                    onChange={() => toggle(item, group)}
                  />{" "}
                  <span className="truncate" title={item.key}>
                    {item.key}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {checked.size > 0 && (
            <button
              className="button danger"
              onClick={() => {
                setDeleteError("");
                setConfirm(true);
              }}
            >
              <Trash2 size={15} /> {t("Delete selected copies", "删除所选副本")} ({checked.size})
            </button>
          )}
        </div>
      )}
      {extension === "download" && (
        <div className="panel stack extension-panel">
          <div className="row between wrap gap">
            <h2 className="row gap">
              <DownloadCloud size={20} /> {t("Sync to a local folder", "同步到本地目录")}
            </h2>
            <div className="row gap">
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
                  <FolderOpen size={15} /> {t("Choose folder", "选择目录")}
                </button>
              )}
              <button
                className="button primary"
                disabled={!connected || !p.capabilities.folders || queuing}
                onClick={() => void sync()}
              >
                {queuing ? t("Preparing download…", "正在准备下载…") : t("Sync now", "立即同步")}
              </button>
            </div>
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
        {t("Remember credentials in system storage", "使用系统凭据存储记住密钥")}
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
export function SettingsPanel({
  p,
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
  const [tab, setTab] = useState("buckets"),
    [ffmpeg, setFFmpeg] = useState<{ available: boolean; executable?: string }>();
  const tabs = [
    ["buckets", t("Bucket settings", "存储桶设置")],
    ["appearance", t("Layout settings", "布局设置")],
    ["language", t("Language settings", "语言设置")],
    ["upload", t("Upload settings", "上传设置")],
    ["download", t("Download settings", "下载设置")],
    ["sharing", t("Sharing settings", "分享设置")],
    ["about", t("About", "关于软件")],
  ];
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
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? "current" : ""} onClick={() => setTab(id!)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="stack settings-content">
          {tab === "buckets" && (
            <>
              <button className="button primary" onClick={add}>
                {t("Add storage bucket", "添加存储桶")}
              </button>
              {profiles.map((profile) => (
                <div className="row between gap" key={profile.id}>
                  <span className="truncate">{profile.label}</span>
                  <div className="row gap">
                    {!profile.demo && (
                      <button className="button" onClick={() => edit(profile)}>
                        {t("Edit", "编辑")}
                      </button>
                    )}
                    <button className="button danger-text" onClick={() => remove(profile)}>
                      {t("Remove", "移除")}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          {tab === "appearance" && (
            <>
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
              <label>
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
            </>
          )}
          {tab === "language" && (
            <label>
              {t("Language", "语言", "言語", "언어")}
              <select
                aria-label="Language"
                value={prefs.language}
                onChange={(e) => set({ language: e.target.value as Preferences["language"] })}
              >
                <option value="en">English</option>
                <option value="zh">简体中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </label>
          )}
          {tab === "upload" && (
            <>
              <div className="form-columns">
                {(
                  [
                    ["files", t("Parallel file uploads", "文件上传并发数"), 1, 16],
                    ["global", t("Total concurrent uploads", "全局上传并发数"), 1, 32],
                    ["perFile", t("Parallel parts per file", "单文件分片并发数"), 1, 16],
                    ["chunkMiB", t("Part size (MiB)", "分片大小（MiB）"), 5, 128],
                    [
                      "thresholdMiB",
                      t("Multipart threshold (MiB)", "分片上传阈值（MiB）"),
                      prefs.uploadTuning.chunkMiB,
                      512,
                    ],
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
              <details className="stack">
                <summary>{t("Default media processing", "默认转码设置")}</summary>
                <MediaRules value={prefs.media} set={(media) => set({ media })} t={t} />
              </details>
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
                />{" "}
                {t("Replace files with the same name by default", "默认替换同名文件")}
              </label>
              {p.capabilities.desktop && (
                <div className="stack">
                  <div className="row between">
                    <strong>FFmpeg</strong>
                    <span className="status-pill">
                      {ffmpeg?.available ? t("Available", "可用") : t("Not configured", "未配置")}
                    </span>
                  </div>
                  {ffmpeg?.executable && (
                    <span className="subtle truncate">{ffmpeg.executable}</span>
                  )}
                  <button
                    className="button"
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
            </>
          )}
          {tab === "download" && (
            <div className="stack">
              <strong>
                {t(
                  "Default download folder",
                  "默认下载目录",
                  "既定のダウンロード先",
                  "기본 다운로드 폴더",
                )}
              </strong>
              <div className="row gap wrap">
                <button
                  className="button"
                  onClick={() =>
                    void run(async () => {
                      const folder = await p.api.pickDestination();
                      if (folder) set({ downloadFolder: folder });
                    })
                  }
                >
                  <FolderOpen size={15} /> {t("Choose folder", "选择目录")}
                </button>
                {prefs.downloadFolder && (
                  <>
                    <button
                      className="button"
                      onClick={() => void run(() => p.api.revealDestination(prefs.downloadFolder))}
                    >
                      {t("Open folder", "打开目录")}
                    </button>
                    <button className="button ghost" onClick={() => set({ downloadFolder: "" })}>
                      {t("Use system Downloads folder", "使用系统下载目录")}
                    </button>
                  </>
                )}
              </div>
              {!prefs.downloadFolder && (
                <span className="muted">{t("System Downloads folder", "系统下载目录")}</span>
              )}
              <label>
                {t("When download completes", "下载完成后的操作")}
                <select
                  value={prefs.downloadCompletion}
                  onChange={(e) =>
                    set({ downloadCompletion: e.target.value as Preferences["downloadCompletion"] })
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
          )}
          {tab === "sharing" && (
            <>
              <label>
                {t("Default link format", "默认链接格式")}
                <select
                  value={prefs.shareFormat}
                  onChange={(e) =>
                    set({ shareFormat: e.target.value as Preferences["shareFormat"] })
                  }
                >
                  <option value="url">URL</option>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="bbcode">BBCode</option>
                </select>
              </label>
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
            <>
              <BarChart3 size={22} />
              <strong>R2Client 0.1.0</strong>
              <span className="subtle">
                MIT ·{" "}
                {t("Independent open-source Cloudflare R2 client", "独立开源 Cloudflare R2 客户端")}
              </span>
              <button
                className="button"
                onClick={() => void p.api.openExternal("https://github.com/Cansiny0320/R2Client")}
              >
                GitHub
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
