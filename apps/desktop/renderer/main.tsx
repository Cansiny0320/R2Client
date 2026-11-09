import { createRoot } from "react-dom/client";
import { Workspace, type Platform } from "@r2client/ui";
import { version } from "../package.json";
import "./style.css";
import "./settings-parity.css";

declare global {
  interface Window {
    r2client?: Platform;
  }
}

const platform = window.r2client;
createRoot(document.getElementById("root")!).render(
  platform ? (
    <Workspace platform={platform} appVersion={version} />
  ) : (
    <main className="initial" role="alert">
      {navigator.language.startsWith("zh")
        ? "无法连接到 R2Client 桌面进程。请重启应用。"
        : "Could not connect to the R2Client desktop process. Restart the app."}
    </main>
  ),
);
