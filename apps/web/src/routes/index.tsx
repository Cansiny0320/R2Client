import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Workspace, type Platform } from "@r2client/ui";
import { browserPlatform } from "../browser";
export const Route = createFileRoute("/")({ component: Page });
function Page() {
  const [platform, setPlatform] = useState<Platform>();
  useEffect(() => {
    setPlatform(window.r2client ?? browserPlatform());
  }, []);
  return platform ? (
    <Workspace platform={platform} />
  ) : (
    <div className="initial">
      <img src="/icon.svg" width={34} height={34} alt="" />
      <span>R2Client</span>
    </div>
  );
}
declare global {
  interface Window {
    r2client?: Platform;
  }
}
