import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  session,
  Tray,
} from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Engine, METHODS } from "@r2client/core";
import type { Call } from "@r2client/core";
import { desktopDriver } from "./files";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "r2app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
const origin = "r2app://local";
const smoke = app.commandLine.getSwitchValue("r2client-smoke-output");
const smokeCurrentProfile = !!smoke && app.commandLine.hasSwitch("r2client-smoke-current-profile");
if (smoke && !smokeCurrentProfile)
  app.setPath("userData", path.join(path.dirname(path.resolve(smoke)), "electron-smoke-profile"));
if (process.platform === "win32") app.setAppUserModelId("top.cansiny.r2client");
const authorized = app.requestSingleInstanceLock();
if (!authorized) app.quit();
else
  void app
    .whenReady()
    .then(start)
    .catch((e) => {
      console.error("R2Client could not start:", e instanceof Error ? e.message : "startup error");
      app.exit(1);
    });

async function start() {
  const ui = path.join(__dirname, "ui");
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: blob: data:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: data: http://localhost:* http://127.0.0.1:*",
    "frame-src https: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
  protocol.handle("r2app", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "local" || request.method !== "GET")
      return new Response(null, { status: 403 });
    const name = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    if (name.includes("\\") || name.includes("\0")) return new Response(null, { status: 400 });
    const p = path.resolve(ui, "." + name),
      relative = path.relative(ui, p);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      return new Response(null, { status: 404 });
    try {
      const resource = await net.fetch(pathToFileURL(p).href);
      const headers = new Headers(resource.headers);
      headers.set("Content-Security-Policy", csp);
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(resource.body, { status: resource.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  let win: BrowserWindow | undefined,
    tray: Tray | undefined,
    quitting = false;
  const native = await desktopDriver(() => win),
    api = new Engine(native.driver);
  function verify(event: IpcMainInvokeEvent) {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame?.url.startsWith(origin + "/")
    )
      throw new Error("Untrusted application sender");
  }
  ipcMain.handle("r2:invoke", async (event, call: Call) => {
    verify(event);
    if (
      !call ||
      !METHODS.has(call.method) ||
      !Array.isArray(call.args) ||
      call.args.length > 6 ||
      call.method === "stage"
    )
      throw new Error("Unsupported application action");
    const handler = api[call.method] as (...args: unknown[]) => unknown;
    return await handler.apply(api, call.args);
  });
  ipcMain.handle(
    "r2:drop",
    async (event, entries: { file: string; relative?: string }[], job?: string) => {
      verify(event);
      if (!Array.isArray(entries) || entries.length > 25000)
        throw new Error("Too many selected files");
      const sources = await native.dropped(entries);
      if (job) {
        if (sources.length !== 1 || !sources[0]) throw new Error("Select the original file");
        await api.attach(job, sources[0]);
      } else await api.stage(sources);
    },
  );
  ipcMain.handle("r2:paste", async (event) => {
    verify(event);
    const data = await native.paste();
    await api.stage(data.sources);
    if (data.urls.length) await api.importUrls(data.urls);
  });
  ipcMain.handle("r2:clipboard", async (event, text: string) => {
    verify(event);
    if (typeof text !== "string" || text.length > 2_000_000)
      throw new Error("Too much clipboard data");
    const { clipboard } = await import("electron");
    await clipboard.writeText(text);
  });
  const restore = () => {
    if (!win || win.isDestroyed()) createWindow();
    win?.show();
    win?.focus();
  };
  function installTray() {
    if (tray) return;
    const icon = nativeImage
      .createFromPath(path.join(__dirname, "icon.png"))
      .resize({ width: 20, height: 20 });
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip("R2Client");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "R2Client", click: restore },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
    tray.on("click", restore);
  }
  async function finishSmoke(view: BrowserWindow) {
    try {
      const result = await view.webContents.executeJavaScript(`(async () => {
        const bridge = window.r2client?.api;
        if (!bridge) throw new Error("Missing preload");
        const snap = await bridge.snapshot();
        const limit = Date.now() + 15000;
        const existing = ${smokeCurrentProfile};
        let profiles = [];
        if (existing) {
          for (const p of snap.profiles) {
            const connected = snap.connected.includes(p.id);
            const listed = connected ? (await bridge.list(p.id, "")).items.length : null;
            profiles.push({ bucket: p.bucket, connected, listed });
          }
        }
        while (Date.now() < limit) {
          const bucket = document.querySelector(".bucket.active .bucket-name strong")?.textContent;
          const active = snap.profiles.find((p) => p.label === bucket);
          const welcome = !!document.querySelector(".setup-welcome h1");
          const fileCards = document.querySelectorAll(".file-card").length;
          if (existing ? active && profiles.some((p) => p.connected) && (fileCards || profiles.every(p => p.listed === 0)) : welcome) {
            return { bridge: true, welcome, profiles, fileCards, activeBucket: active?.bucket };
          }
          await new Promise((r) => setTimeout(r, 75));
        }
        throw new Error("Expected startup view did not render");
      })()`);
      const { available: ffmpeg } = await api.ffmpegStatus();
      await writeFile(smoke, JSON.stringify({ ...result, ffmpeg }));
      app.exit(result?.bridge ? 0 : 1);
    } catch (e) {
      await writeFile(
        smoke,
        JSON.stringify({ error: e instanceof Error ? e.message : "startup failure" }),
      );
      app.exit(1);
    }
  }
  function createWindow() {
    win = new BrowserWindow({
      width: 1360,
      height: 860,
      minWidth: 790,
      minHeight: 530,
      show: false,
      backgroundColor: "#faf9f7",
      icon: path.join(__dirname, "icon.png"),
      title: "R2Client",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith(origin + "/")) e.preventDefault();
    });
    win.webContents.on("will-attach-webview", (e) => e.preventDefault());
    if (smoke) {
      const view = win;
      view.webContents.once("did-finish-load", () => void finishSmoke(view));
      view.webContents.once("did-fail-load", (_event, _code, message) => {
        void writeFile(smoke, JSON.stringify({ error: message })).finally(() => app.exit(1));
      });
    } else win.once("ready-to-show", () => win?.show());
    win.on("close", (e) => {
      if (quitting || !tray) return;
      e.preventDefault();
      win?.hide();
    });
    win.on("closed", () => {
      win = undefined;
    });
    void win.loadURL(origin + "/");
  }
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ])
      : null,
  );
  if (smoke) await mkdir(path.dirname(path.resolve(smoke)), { recursive: true });
  createWindow();
  if (!smoke) installTray();
  const timer = setInterval(() => void api.tick().catch(() => {}), 60000);
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(timer);
    tray?.destroy();
    tray = undefined;
  });
  app.on("second-instance", restore);
  app.on("activate", restore);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
