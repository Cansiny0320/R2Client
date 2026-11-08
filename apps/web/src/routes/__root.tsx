import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "../style.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width,initial-scale=1" },
      { title: "R2Client" },
      { name: "description", content: "Open-source Cloudflare R2 file manager" },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/icon.svg" }],
  }),
  component: Outlet,
  shellComponent: Document,
});
function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
