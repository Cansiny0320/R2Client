import { expect, test } from "@playwright/test";

test("image preview uses a full screen gallery, wraps, and never carries over an image", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const profile = {
      id: "gallery",
      label: "Fixture",
      bucket: "fixture",
      accountId: "0".repeat(32),
      jurisdiction: "default",
      publicBase: "",
    };
    const items = ["first.png", "second.png"].map((key) => ({
      key,
      kind: "object",
      size: 68,
      modified: "2026-11-09T00:00:00Z",
    }));
    const data =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=";
    Object.assign(window, {
      r2client: {
        capabilities: { desktop: true, folders: true },
        api: {
          snapshot: async () => ({
            profiles: [profile],
            connected: [profile.id],
            jobs: [],
            stages: [],
          }),
          index: async () => undefined,
          list: async () => ({ items }),
          detail: async (_id: string, key: string) => ({
            ...items.find((x) => x.key === key),
            type: "image/png",
            metadata: {},
          }),
          links: async (_id: string, key: string, _seconds: number, mode: string) =>
            mode === "preview" ? data : "https://example.test/" + key,
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Preview first.png" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toHaveAccessibleName("first.png");
  await expect(viewer).toHaveClass(/dialog-page/);
  await expect(viewer.getByRole("img", { name: "first.png" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Back" })).toBeFocused();
  await expect
    .poll(() =>
      viewer
        .getByRole("img", { name: "first.png" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toHaveAccessibleName("second.png");
  await expect(viewer.getByRole("img", { name: "first.png" })).toHaveCount(0);
  await expect(viewer.getByRole("img", { name: "second.png" })).toBeVisible();
  await viewer.getByRole("button", { name: "Next file" }).click();
  await expect(viewer).toHaveAccessibleName("first.png");
  await viewer.getByRole("button", { name: "Share and QR code" }).click();
  const share = page.getByRole("dialog", { name: "Share file" });
  await expect(share.getByRole("img", { name: "QR code" })).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toHaveAccessibleName("first.png");
  await viewer.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("dialog", { name: "Rename" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("requires the Electron preload instead of providing a web client", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Could not connect");
  await expect(page.getByRole("button", { name: "Create your first bucket" })).toHaveCount(0);
});

test("first launch goes through the five-step wizard and restores a connected bucket", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const stored = () => JSON.parse(localStorage.getItem("test-bucket") || "null");
    const global = window as unknown as Record<string, unknown>;
    let attempts = 0;
    global.r2client = {
      capabilities: { desktop: true, folders: true },
      api: {
        snapshot: async () => ({
          profiles: stored() ? [stored()] : [],
          connected: stored() ? ["fixture"] : [],
          jobs: [],
          stages: [],
        }),
        index: async () => undefined,
        list: async () => ({
          items: [{ key: "fixture.txt", kind: "object", modified: "", size: 5 }],
        }),
        scan: async () => ({ objects: [], updated: "2026-11-08T00:00:00Z", history: [] }),
        connect: async (input: Record<string, unknown>) => {
          if (++attempts === 1) throw new Error("Test connection refused");
          const { credentials: _credentials, remember: _remember, ...profile } = input;
          localStorage.setItem("test-bucket", JSON.stringify({ ...profile, id: "fixture" }));
        },
      },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to R2 Desktop" })).toBeVisible();
  await expect(page.getByText("demo-assets")).toHaveCount(0);
  await page.getByRole("button", { name: "Create your first bucket" }).click();
  const next = page.getByRole("button", { name: "Next step" });
  await expect(next).toBeDisabled();
  await page.getByLabel("Account ID").fill("a".repeat(32));
  await next.click();
  await page.locator("#wizard-access").fill("fixture_access");
  await page.getByLabel("Secret Access Key").fill("fixture_secret");
  await page.getByRole("button", { name: "Show secret key" }).click();
  await expect(page.getByLabel("Secret Access Key")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide secret key" }).click();
  await next.click();
  await page.getByLabel("Bucket name").fill("fixture-bucket");
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.getByLabel("Secret Access Key")).toHaveValue("fixture_secret");
  await next.click();
  await expect(page.getByLabel("Bucket name")).toHaveValue("fixture-bucket");
  await next.click();
  await page.getByRole("switch", { name: "Enable public access" }).check();
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: "Review configuration" })).toBeVisible();
  await expect(page.getByText("fixture_secret", { exact: true })).toHaveCount(0);
  const save = page.getByRole("button", { name: "Validate and save" });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Test connection refused");
  await save.click();
  await expect(page.getByRole("heading", { name: "Bucket added successfully!" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Initial sync complete");
  await page.getByRole("button", { name: "Return to list" }).click();
  await expect(page.getByRole("button", { name: "fixture.txt", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "fixture.txt", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("fixture_secret");
});
test("desktop toolbar and saved download folder work without showing a real picker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls = { picks: 0, downloads: [] as string[] };
    const global = window as unknown as Record<string, unknown>;
    global.desktopAlignmentCalls = calls;
    const profile = {
      id: "alignment",
      label: "reference-bucket",
      bucket: "reference-bucket",
      accountId: "0".repeat(32),
      jurisdiction: "default",
      publicBase: "",
    };
    global.r2client = {
      capabilities: { desktop: true, folders: true },
      api: {
        snapshot: async () => ({
          profiles: [profile],
          connected: [profile.id],
          jobs: [],
          stages: [],
          platform: "desktop",
        }),
        index: async () => undefined,
        list: async () => ({
          items: [
            { kind: "object", key: "report.txt", size: 20, modified: "2026-11-08T00:00:00Z" },
            ...Array.from({ length: 104 }, (_, i) => ({
              kind: "object",
              key: `fixture-${i}.txt`,
              size: 1,
              modified: "",
            })),
          ],
        }),
        ffmpegStatus: async () => ({ available: true }),
        schedules: async () => [],
        scan: async () => ({
          objects: [
            { key: "report.txt", kind: "object", size: 20, modified: "2026-11-08T00:00:00Z" },
          ],
          updated: "2026-11-08T00:00:00Z",
          history: [{ at: "2026-11-08T00:00:00Z", bytes: 20, count: 1 }],
        }),
        duplicates: async () => [],
        pickDestination: async () => {
          calls.picks++;
          return "chosen-local-folder";
        },
        download: async (_id: string, _items: unknown[], directory: string) => {
          calls.downloads.push(directory);
        },
      },
    };
  });
  await page.goto("/");
  await expect(page.locator(".file-card")).toHaveCount(100);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".file-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.locator(".file-card")).toHaveCount(100);
  await page
    .getByRole("button", { name: "Bucket settings · reference-bucket", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Edit storage bucket" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByRole("combobox", { name: "Sort files" })).toHaveCount(0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Search files" });
  await expect(search.getByRole("combobox", { name: "Sort files" })).toBeVisible();
  await search.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: "Download settings", exact: true }).click();
  await settings.getByRole("button", { name: "Choose folder", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Use system Downloads folder" })).toBeVisible();
  await settings.getByRole("button", { name: "Back", exact: true }).click();

  await page.reload();
  const selectAll = page.getByRole("button", { name: "Select all", exact: true });
  await selectAll.click();
  await expect(selectAll).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const getCalls = () =>
    page.evaluate(() => (window as unknown as Record<string, unknown>).desktopAlignmentCalls);
  await expect.poll(getCalls).toEqual({ picks: 0, downloads: ["chosen-local-folder"] });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await settings.getByRole("button", { name: "Download settings", exact: true }).click();
  await settings.getByRole("button", { name: "Use system Downloads folder", exact: true }).click();
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect.poll(getCalls).toEqual({ picks: 0, downloads: ["chosen-local-folder", ""] });

  await page.getByRole("button", { name: "Upload files", exact: true }).click();
  await expect(page.getByRole("button", { name: "Browse files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Paste from clipboard" })).toBeVisible();
  await page.getByRole("button", { name: "Add URLs" }).click();
  const importDialog = page.getByRole("dialog", { name: "Add remote files" });
  await expect(importDialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await importDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await expect(page.getByText("No transfers here")).toBeVisible();
  await page.getByRole("button", { name: "Storage statistics" }).click();
  await page.getByRole("button", { name: "Sync bucket" }).click();
  await expect(page.getByRole("heading", { name: "Object types" })).toBeVisible();
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  await page.getByRole("button", { name: "Scan by content" }).click();
  await expect(page.getByText("No duplicate content found")).toBeVisible();
  await page.getByRole("button", { name: "Bucket download" }).click();
  await expect(page.getByRole("button", { name: "Enable schedule" })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const [label, content] of [
    ["Layout settings", settings.getByLabel("Theme")],
    ["Language settings", settings.getByLabel("Language", { exact: true })],
    ["Upload settings", settings.getByText("FFmpeg", { exact: true })],
    ["Sharing settings", settings.getByLabel("Default link format")],
    ["About", settings.getByText("R2Client 0.1.0", { exact: true })],
  ] as const) {
    await settings.getByRole("button", { name: label, exact: true }).click();
    await expect(content).toBeVisible();
  }
});

test("orders all folders before files even when the folder arrives on a later R2 page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const profile = {
      id: "folder-parity",
      label: "Folder parity",
      bucket: "folder-parity",
      accountId: "0".repeat(32),
      jurisdiction: "default",
      publicBase: "",
    };
    const state = { calls: 0 };
    Object.assign(window, {
      folderParity: state,
      r2client: {
        capabilities: { desktop: true, folders: true },
        api: {
          snapshot: async () => ({
            profiles: [profile],
            connected: [profile.id],
            jobs: [],
            stages: [],
          }),
          index: async () => undefined,
          list: async (_id: string, prefix: string, cursor?: string) => {
            state.calls++;
            if (prefix === "z-folder/") return { items: [] };
            if (cursor === "second") {
              return { items: [{ kind: "folder", key: "z-folder/", size: 0, modified: "" }] };
            }
            return {
              items: Array.from({ length: 200 }, (_, i) => ({
                kind: "object",
                key: "file-" + i + ".txt",
                size: 1,
                modified: "",
              })),
              next: "second",
            };
          },
        },
      },
    });
  });
  await page.goto("/");
  const folder = page.getByRole("button", { name: "z-folder", exact: true });
  await expect(
    page.locator(".file-card").first().getByRole("button", { name: "z-folder", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(folder).toHaveCount(0);
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(folder).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { folderParity: { calls: number } }).folderParity.calls,
      ),
    )
    .toBe(2);
  await folder.click();
  await expect(page.getByRole("button", { name: "z-folder", exact: true })).toBeVisible();
});

test("loads visible thumbnails in small batches instead of fetching the entire grid at once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=",
    "base64",
  );
  const requests = { started: 0, inFlight: 0, max: 0 };
  await page.route("https://images.example.test/**", async (route) => {
    requests.started++;
    requests.inFlight++;
    requests.max = Math.max(requests.inFlight, requests.max);
    await new Promise((r) => setTimeout(r, 120));
    requests.inFlight--;
    await route.fulfill({ contentType: "image/png", body: png });
  });
  await page.addInitScript(() => {
    const profile = {
      id: "thumbnail-parity",
      label: "Thumbnail parity",
      bucket: "thumbnail-parity",
      accountId: "0".repeat(32),
      jurisdiction: "default",
      publicBase: "",
    };
    Object.assign(window, {
      r2client: {
        capabilities: { desktop: true, folders: true },
        api: {
          snapshot: async () => ({
            profiles: [profile],
            connected: [profile.id],
            jobs: [],
            stages: [],
          }),
          index: async () => undefined,
          list: async () => ({
            items: Array.from({ length: 60 }, (_, i) => ({
              key: "photo-" + i + ".png",
              kind: "object",
              size: 2_000_000,
              modified: "",
            })),
          }),
          links: async (_id: string, key: string) => "https://images.example.test/" + key,
        },
      },
    });
  });
  await page.goto("/");
  await expect.poll(() => requests.started).toBeGreaterThan(4);
  await expect.poll(() => requests.inFlight).toBe(0);
  expect(requests.max).toBeLessThanOrEqual(4);
  expect(requests.started).toBeLessThan(60);
  await expect
    .poll(() =>
      page
        .locator(".thumbnail img")
        .evaluateAll(
          (images) => images.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length,
        ),
    )
    .toBeGreaterThan(4);
});
