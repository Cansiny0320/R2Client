import {
  ArrowUpToLine,
  BarChart3,
  Blocks,
  Cloud,
  Database,
  Files as FileIcon,
  ListChecks,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { byteLabel, errorText } from "@r2client/core";
import type { Index, Profile, Snapshot } from "@r2client/core";
import {
  dateLabel,
  defaults,
  droppedFiles,
  Empty,
  IconButton,
  Modal,
  tabStrings,
  translator,
} from "./common";
import type { Platform, Preferences } from "./common";
import { Files } from "./files";
import { Uploads, TransfersPanel } from "./transfers";
import { ConnectionModal, Extensions, SettingsPanel, Statistics } from "./panels";
export type { Platform } from "./common";

type Tab = "files" | "upload" | "transfers" | "statistics" | "extensions";
const tabs: { id: Tab; icon: typeof FileIcon }[] = [
  { id: "files", icon: FileIcon },
  { id: "upload", icon: ArrowUpToLine },
  { id: "transfers", icon: ListChecks },
  { id: "statistics", icon: BarChart3 },
  { id: "extensions", icon: Blocks },
];
const storage = "r2client-preferences";
const usePreferences = create<{
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}>((set) => ({
  prefs: defaults,
  change: (patch) =>
    set((s) => {
      const prefs = { ...s.prefs, ...patch };
      localStorage.setItem(storage, JSON.stringify(prefs));
      return { prefs };
    }),
}));
export function Workspace({ platform: p }: { platform: Platform }) {
  const [data, setData] = useState<Snapshot>({
    profiles: [],
    connected: [],
    jobs: [],
    stages: [],
    platform: p.capabilities.desktop ? "desktop" : "web",
  });
  const [bucket, setBucket] = useState(""),
    [tab, setTab] = useState<Tab>("files"),
    [prefix, setPrefix] = useState(""),
    [index, setIndex] = useState<Index>();
  const [settings, setSettings] = useState(false),
    [connection, setConnection] = useState<Profile | null>(),
    [remove, setRemove] = useState<Profile>(),
    [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number }>(),
    [ready, setReady] = useState(false),
    [startup, setStartup] = useState(""),
    [dragging, setDragging] = useState(false);
  const [sort, setSort] = useState<"manual" | "name" | "size" | "updated">("manual");
  const [known, setKnown] = useState<Record<string, { bytes: number; updated: string }>>({});
  const profileIds = data.profiles.map((p) => p.id).join(",");
  useEffect(() => {
    let active = true;
    if (sort === "size" || sort === "updated") {
      void Promise.all(
        profileIds
          .split(",")
          .filter(Boolean)
          .map(async (id) => {
            const value = await p.api.index(id);
            return [
              id,
              {
                bytes: value?.objects.reduce((s, o) => s + o.size, 0) ?? 0,
                updated: value?.updated ?? "",
              },
            ] as const;
          }),
      )
        .then((rows) => {
          if (active) setKnown(Object.fromEntries(rows));
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [p, profileIds, sort, index?.updated]);
  const { prefs, change } = usePreferences();
  const t = translator(prefs.language),
    names = tabStrings(t);
  const profile = data.profiles.find((x) => x.id === bucket) ?? data.profiles[0];
  const pull = useCallback(async () => {
    const snap = await p.api.snapshot();
    setData((old) => (JSON.stringify(old) === JSON.stringify(snap) ? old : snap));
    setReady(true);
    setStartup("");
  }, [p]);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error, id: Date.now() }),
    [],
  );
  const run = useCallback(
    async <T,>(operation: () => Promise<T>, success?: string) => {
      try {
        const r = await operation();
        if (success) notify(success);
        return r;
      } catch (e) {
        notify(errorText(e), true);
        return undefined;
      }
    },
    [notify],
  );
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storage),
        lang = navigator.language.slice(0, 2);
      if (saved) change(JSON.parse(saved));
      else if (["en", "zh", "ja", "ko"].includes(lang))
        change({ language: lang as Preferences["language"] });
      const previous = localStorage.getItem("r2client-active");
      if (previous) setBucket(previous);
    } catch {
      /* start with defaults */
    }
  }, [change]);
  useEffect(() => {
    void pull().catch((e) => setStartup(errorText(e)));
    const timer = setInterval(() => void pull().catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [pull]);
  useEffect(() => {
    setIndex(undefined);
    if (!profile) return;
    let live = true;
    void p.api
      .index(profile.id)
      .then((v) => {
        if (live) setIndex(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [p, profile?.id]);
  useEffect(() => {
    document.documentElement.lang = prefs.language === "zh" ? "zh-CN" : prefs.language;
  }, [prefs.language]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), toast.error ? 9000 : 4000);
    return () => clearTimeout(id);
  }, [toast]);
  function select(id: string) {
    setBucket(id);
    localStorage.setItem("r2client-active", id);
    setPrefix("");
    setTab("files");
    setSidebar(false);
  }
  const list =
    sort === "manual"
      ? data.profiles
      : [...data.profiles].sort((a, b) =>
          sort === "size"
            ? (known[b.id]?.bytes ?? 0) - (known[a.id]?.bytes ?? 0)
            : sort === "updated"
              ? (known[b.id]?.updated ?? "").localeCompare(known[a.id]?.updated ?? "")
              : a.label.localeCompare(b.label),
        );
  const used = index?.objects.reduce((n, x) => n + x.size, 0);
  const current = !!profile && data.connected.includes(profile.id);
  return (
    <div
      className="workspace"
      data-theme={prefs.theme}
      style={{ zoom: prefs.zoom / 100 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        const dt = e.dataTransfer;
        void run(async () => {
          await p.addFiles(await droppedFiles(dt));
          await pull();
          setTab("upload");
        });
      }}
      onPaste={(e) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          settings ||
          connection !== undefined
        )
          return;
        const files = [...e.clipboardData.files];
        if (!files.length) return;
        e.preventDefault();
        void run(async () => {
          await p.addFiles(files.map((file) => ({ file })));
          await pull();
          setTab("upload");
        });
      }}
    >
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <div className="brand">
          <img src="/icon.svg" alt="" width={34} height={34} />
          <span>R2CLIENT</span>
          <IconButton
            className="mobile-close"
            label={t("Close sidebar", "关闭侧栏")}
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <div className="bucket-heading">
          <strong>{t("Storage buckets", "存储桶列表", "バケット", "버킷 목록")}</strong>
          <IconButton
            label={t("Add storage bucket", "添加存储桶", "バケットを追加", "버킷 추가")}
            onClick={() => setConnection(null)}
          >
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="bucket-list">
          {list.map((row) => (
            <button
              key={row.id}
              aria-label={
                row.label +
                " " +
                (row.demo
                  ? t("Demo", "示例", "デモ", "데모")
                  : row.publicBase
                    ? t("Public", "公开")
                    : t("Private", "私有"))
              }
              draggable={sort === "manual"}
              onDragStart={(e) => e.dataTransfer.setData("application/x-r2client-bucket", row.id)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-r2client-bucket"))
                  e.preventDefault();
              }}
              onDrop={(e) => {
                const dragged = e.dataTransfer.getData("application/x-r2client-bucket");
                if (!dragged || dragged === row.id) return;
                e.preventDefault();
                const ids = data.profiles.map((p) => p.id),
                  before = ids.indexOf(dragged),
                  after = ids.indexOf(row.id);
                if (before < 0 || after < 0) return;
                ids.splice(before, 1);
                ids.splice(after, 0, dragged);
                void run(async () => {
                  await p.api.reorder(ids);
                  await pull();
                });
              }}
              className={"bucket " + (row.id === profile?.id ? "active" : "")}
              onClick={() => select(row.id)}
            >
              <span className="bucket-line">
                <span className="bucket-icon">
                  <Database size={17} />
                </span>
                <span className="bucket-name">
                  <strong title={row.label}>{row.label}</strong>
                  <small>
                    {row.demo
                      ? t("Demo", "示例", "デモ", "데모")
                      : row.publicBase
                        ? t("Public", "公开", "公開", "공개")
                        : t("Private", "私有", "非公開", "비공개")}
                  </small>
                </span>
                {!row.demo && (
                  <span
                    className={
                      "status-dot " + (data.connected.includes(row.id) ? "" : "status-off")
                    }
                    title={data.connected.includes(row.id) ? "Connected" : "Disconnected"}
                  />
                )}
              </span>
              {row.id === profile?.id && (
                <span className="bucket-info">
                  <span className="row between">
                    <span>{t("Storage info", "存储信息")}</span>
                    <b>{used === undefined ? "—" : byteLabel(used)}</b>
                  </span>
                  <span className="row between">
                    <span>{t("Last updated", "最后更新")}</span>
                    <b>{dateLabel(index?.updated ?? "")}</b>
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
        {list.length > 1 && (
          <select
            className="sort-buckets"
            aria-label={t("Bucket order", "存储桶排序", "バケットの順序", "버킷 순서")}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="manual">{t("Custom order", "自定义排序")}</option>
            <option value="name">{t("Name order", "按名称排序")}</option>
            <option value="size">{t("Largest first", "最大优先")}</option>
            <option value="updated">{t("Newest first", "最新优先")}</option>
          </select>
        )}
        <div className="sidebar-bottom">
          <button className="settings-button" onClick={() => setSettings(true)}>
            <Settings size={17} /> {t("Settings", "设置", "設定", "설정")}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <IconButton
            className="mobile-menu"
            label={t("Open sidebar", "打开侧栏")}
            onClick={() => setSidebar((s) => !s)}
          >
            <Menu size={20} />
          </IconButton>
          <nav className="top-tabs" aria-label={t("Workspace", "工作区")}>
            {tabs.map(({ id, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={tab === id ? "current" : ""}
                onClick={() => setTab(id)}
              >
                <Icon size={16} />
                {names[id]}
                {id === "transfers" && data.jobs.some((j) => j.state === "running") && (
                  <span className="tab-dot" />
                )}
              </button>
            ))}
          </nav>
          {p.capabilities.desktop && (
            <ShieldCheck
              className="desktop-indicator"
              aria-label={t("Desktop", "桌面端")}
              size={17}
            />
          )}
        </header>
        {!ready ? (
          <Empty label={startup || t("Loading…", "正在加载…")} />
        ) : tab === "files" && profile ? (
          <Files
            key={profile.id}
            platform={p}
            profile={profile}
            prefix={prefix}
            go={setPrefix}
            connected={current}
            prefs={prefs}
            setPrefs={change}
            t={t}
            run={run}
            notify={notify}
            upload={() => setTab("upload")}
            connect={() => setConnection(profile)}
            index={index}
            setIndex={setIndex}
          />
        ) : tab === "files" ? (
          <Empty
            label={t("No storage buckets", "尚未添加存储桶")}
            action={
              <button className="button primary" onClick={() => setConnection(null)}>
                <Plus size={15} /> {t("Add storage bucket", "添加存储桶")}
              </button>
            }
          />
        ) : null}
        {ready && tab === "upload" && (
          <Uploads
            p={p}
            snapshot={data}
            profile={profile}
            prefix={prefix}
            prefs={prefs}
            t={t}
            run={run}
            changed={pull}
            notify={notify}
            transfers={() => setTab("transfers")}
          />
        )}
        {ready && tab === "transfers" && (
          <TransfersPanel p={p} snapshot={data} t={t} run={run} changed={pull} />
        )}
        {ready && tab === "statistics" && (
          <Statistics
            p={p}
            profile={profile}
            jobs={data.jobs}
            index={index}
            setIndex={setIndex}
            t={t}
            run={run}
          />
        )}
        {ready && tab === "extensions" && (
          <Extensions
            p={p}
            profile={profile}
            prefix={prefix}
            t={t}
            run={run}
            notify={notify}
            changed={pull}
          />
        )}
      </main>
      {dragging && (
        <div className="drag-overlay">
          <Cloud size={48} />
          {t("Drop to stage files", "松开以暂存文件")}
        </div>
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "toast-error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <IconButton label={t("Dismiss", "关闭")} onClick={() => setToast(undefined)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {settings && (
        <SettingsPanel
          p={p}
          prefs={prefs}
          set={change}
          t={t}
          close={() => setSettings(false)}
          profiles={data.profiles}
          edit={(v) => {
            setSettings(false);
            setConnection(v);
          }}
          add={() => {
            setSettings(false);
            setConnection(null);
          }}
          remove={(v) => {
            setSettings(false);
            setRemove(v);
          }}
          run={run}
        />
      )}
      {connection !== undefined && (
        <ConnectionModal
          p={p}
          profile={connection ?? undefined}
          t={t}
          close={() => setConnection(undefined)}
          saved={async () => {
            const next = await p.api.snapshot();
            setData(next);
            const id = connection?.id ?? next.profiles.at(-1)?.id;
            if (id) select(id);
          }}
        />
      )}
      {remove && (
        <Modal open title={t("Remove connection", "移除连接")} onClose={() => setRemove(undefined)}>
          <div className="dialog-body stack">
            <p>
              {remove.label} ·{" "}
              {t("Only the saved connection is removed.", "只移除此处的连接配置。")}
            </p>
            <button
              className="button danger"
              onClick={() =>
                void run(async () => {
                  await p.api.removeProfile(remove.id);
                  setRemove(undefined);
                  await pull();
                })
              }
            >
              {t("Remove", "移除")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
