import { expect, test } from "@playwright/test";
import { version as desktopVersion } from "../../apps/desktop/package.json";

test("image preview uses a full screen gallery, wraps, and never carries over an image", async ({
  page,
}) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=",
    "base64",
  );
  const imageRequests: string[] = [];
  await page.route("https://preview.example.test/**", async (route) => {
    imageRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      contentType: "image/png",
      headers: { "Cache-Control": "no-store" },
      body: png,
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("r2client-preferences", JSON.stringify({ preview: false }));
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
    const detailRequests: string[] = [];
    const firstDetail = new Promise<void>((resolve) => {
      window.addEventListener("release-preview-head", () => resolve(), { once: true });
    });
    let linkRequests = 0;
    Object.assign(window, {
      detailRequests,
      previewDownloads: [] as string[],
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
          downloadAs: async (_id: string, item: { key: string }) => {
            (window as unknown as { previewDownloads: string[] }).previewDownloads.push(item.key);
            return true;
          },
          detail: async (_id: string, key: string) => {
            detailRequests.push(key);
            if (key === "first.png") await firstDetail;
            return { ...items.find((x) => x.key === key), type: "image/png", metadata: {} };
          },
          links: async (_id: string, key: string, _seconds: number, mode: string) =>
            mode === "preview"
              ? `https://preview.example.test/${key}?signature=${++linkRequests}`
              : "https://example.test/" + key,
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
  const expectImageLoaded = (name: string) =>
    expect
      .poll(() =>
        viewer.getByRole("img", { name }).evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
  await expectImageLoaded("first.png");
  await page.evaluate(() => window.dispatchEvent(new Event("release-preview-head")));
  await viewer.getByText("File information").click();
  await expect(viewer.getByText("image/png", { exact: true })).toBeVisible();
  const image = viewer.getByRole("img", { name: "first.png" });
  const originalWidth = (await image.boundingBox())!.width;
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByRole("button", { name: "Reset zoom" })).toHaveText("125%");
  expect((await image.boundingBox())!.width).toBeGreaterThan(originalWidth);
  await viewer.getByRole("button", { name: "Save as…" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { previewDownloads: string[] }).previewDownloads,
    ),
  ).toEqual(["first.png"]);
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toHaveAccessibleName("second.png");
  await expect(viewer.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
  await expect(viewer.getByRole("img", { name: "first.png" })).toHaveCount(0);
  await expect(viewer.getByRole("img", { name: "second.png" })).toBeVisible();
  await expectImageLoaded("second.png");
  await viewer.getByRole("button", { name: "Next file" }).click();
  await expect(viewer).toHaveAccessibleName("first.png");
  await expectImageLoaded("first.png");
  await expect(viewer.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
  await expect(viewer.locator("details[open]:visible")).toHaveCount(0);
  expect(imageRequests).toEqual(["/first.png", "/second.png"]);
  expect(
    await page.evaluate(() => (window as unknown as { detailRequests: string[] }).detailRequests),
  ).toEqual(["first.png", "second.png"]);
  await viewer.getByRole("button", { name: "Share and QR code" }).click();
  const share = page.getByRole("dialog", { name: "Share file" });
  await expect(share.getByRole("img", { name: "QR code" })).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toHaveAccessibleName("first.png");
  await viewer.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Preview first.png" })).toBeFocused();
  await page.getByRole("button", { name: "Preview first.png" }).click();
  await viewer.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("dialog", { name: "Rename" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("audio preview plays, seeks, and restores the volume after muting", async ({ page }) => {
  const sampleRate = 8000;
  const sampleBytes = 4 * sampleRate * 2;
  const wav = Buffer.alloc(44 + sampleBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + sampleBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleBytes, 40);
  await page.route("https://preview.example.test/tone.wav", (route) => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) {
      return route.fulfill({ contentType: "audio/wav", body: wav });
    }
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: 206,
      contentType: "audio/wav",
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${first}-${last}/${wav.length}` },
      body: wav.subarray(first, last + 1),
    });
  });
  await page.addInitScript(() => {
    const profile = {
      id: "audio",
      label: "Fixture",
      bucket: "fixture",
      accountId: "0".repeat(32),
      jurisdiction: "default",
      publicBase: "",
    };
    const item = { key: "tone.wav", kind: "object", size: 64044, modified: "", type: "audio/wav" };
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
          list: async () => ({ items: [item] }),
          detail: async () => ({ ...item, metadata: {} }),
          links: async () => "https://preview.example.test/tone.wav",
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Preview tone.wav" }).click();
  const viewer = page.getByRole("dialog", { name: "tone.wav" });
  const position = viewer.getByRole("slider", { name: "Playback position" });
  await expect(position).toBeEnabled();
  const track = (await position.boundingBox())!;
  await position.click({ position: { x: track.width / 2, y: track.height / 2 } });
  const audio = viewer.locator("audio");
  await expect
    .poll(() => audio.evaluate((player: HTMLAudioElement) => player.currentTime))
    .toBeCloseTo(2, 1);
  await viewer.getByRole("button", { name: "Play", exact: true }).click();
  await viewer.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(viewer.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await viewer.getByRole("slider", { name: "Volume" }).press("ArrowLeft");
  await viewer.getByRole("button", { name: "Mute", exact: true }).click();
  expect(await audio.evaluate((player: HTMLAudioElement) => player.muted)).toBe(true);
  await viewer.getByRole("button", { name: "Unmute", exact: true }).click();
  expect(await audio.evaluate((player: HTMLAudioElement) => [player.muted, player.volume])).toEqual(
    [false, 0.79],
  );
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
    let scans = 0;
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
        scan: async () => {
          if (++scans === 1) throw new Error("Connection lost during initial sync");
          return { objects: [], updated: "2026-11-08T00:00:00Z", history: [] };
        },
        connect: async (input: Record<string, unknown>) => {
          if (++attempts === 1)
            throw new Error("Error invoking remote method 'r2:invoke': Unauthorized: Unauthorized");
          if (attempts > 2) throw new Error("Retry must not save the connection again");
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
  await expect(page.getByRole("alert")).toContainText("Check the R2 credentials");
  await expect(page.getByRole("alert")).not.toContainText("r2:invoke");
  await page.getByRole("button", { name: "Edit credentials" }).click();
  await expect(page.getByLabel("Secret Access Key")).toHaveValue("fixture_secret");
  await next.click();
  await next.click();
  await next.click();
  await save.click();
  await expect(page.getByRole("heading", { name: "Bucket added successfully!" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Initial sync failed");
  await page.getByRole("button", { name: "Retry sync" }).click();
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
    let duplicateScans = 0;
    let bucketScans = 0;
    const duplicates = ["one.txt", "two.txt"].map((key) => ({
      key,
      kind: "object",
      size: 4,
      modified: "",
      etag: key,
    }));
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
        scan: async () => {
          if (++bucketScans === 1) throw new Error("connect ETIMEDOUT");
          return {
            objects: [
              { key: "report.txt", kind: "object", size: 20, modified: "2026-11-08T00:00:00Z" },
            ],
            updated: "2026-11-08T00:00:00Z",
            history: [{ at: "2026-11-08T00:00:00Z", bytes: 20, count: 1 }],
          };
        },
        duplicates: async () => (++duplicateScans === 1 ? [] : [duplicates]),
        detail: async (_id: string, key: string) => ({ key, etag: key }),
        mutate: async (
          _id: string,
          changes: { key: string; kind: string; expectedEtag: string }[],
        ) =>
          changes.map((change) => ({
            key: change.key,
            ok:
              change.kind === "delete" &&
              change.key === "one.txt" &&
              change.expectedEtag === "one.txt",
          })),
        pickDestination: async () => {
          calls.picks++;
          return "chosen-local-folder";
        },
        destinationPath: async (id: string) =>
          id === "chosen-local-folder"
            ? "/tmp/r2client-fixture-only"
            : id === ""
              ? "/Users/test/Downloads"
              : undefined,
        download: async (_id: string, _items: unknown[], directory: string) => {
          calls.downloads.push(directory);
        },
        syncDirectory: async (id: string, prefix: string, directory: string) => {
          global.bucketDownload = { id, prefix, directory };
          return 1;
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

  await expect(page.getByRole("combobox", { name: "Sort files" })).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Search Files" });
  await expect(search.getByRole("combobox", { name: "Sort files" })).toHaveCount(0);
  await search.getByLabel("File type filter").click();
  await search.getByRole("combobox", { name: "Filter files" }).selectOption("image");
  await search.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "report.txt", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const sections = settings.getByRole("navigation", { name: "Settings sections" });
  await expect(settings.getByRole("heading", { name: "Buckets", exact: true })).toBeVisible();
  await sections.getByRole("button", { name: "Download", exact: true }).click();
  const currentPath = settings.getByRole("textbox", { name: "Current download path" });
  await expect(currentPath).toHaveValue("/Users/test/Downloads");
  await settings.getByRole("button", { name: "Choose folder", exact: true }).click();
  await expect(currentPath).toHaveValue("/tmp/r2client-fixture-only");
  await expect(
    settings.getByRole("button", { name: "Reset to system Downloads folder" }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Back", exact: true }).click();

  await page.reload();
  const selectAll = page.getByRole("button", { name: "Select all", exact: true });
  await selectAll.click();
  await expect(page.getByRole("button", { name: "Unselect all", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Batch actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  const getCalls = () =>
    page.evaluate(() => (window as unknown as Record<string, unknown>).desktopAlignmentCalls);
  await expect.poll(getCalls).toEqual({ picks: 0, downloads: ["chosen-local-folder"] });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await sections.getByRole("button", { name: "Download", exact: true }).click();
  await expect(currentPath).toHaveValue("/tmp/r2client-fixture-only");
  await settings
    .getByRole("button", { name: "Reset to system Downloads folder", exact: true })
    .click();
  await expect(currentPath).toHaveValue("/Users/test/Downloads");
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Batch actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  await expect.poll(getCalls).toEqual({ picks: 0, downloads: ["chosen-local-folder", ""] });

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  const dropArea = page.locator(".upload-drop");
  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await expect(navigation).toBeVisible();
  expect(await navigation.boundingBox()).toEqual({ x: 455, y: 17, width: 658, height: 48 });
  expect(await dropArea.boundingBox()).toEqual({ x: 312, y: 106, width: 944, height: 690 });
  await expect(dropArea.getByRole("button", { name: "Browse files" })).toBeVisible();
  await expect(dropArea.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(dropArea.getByRole("button", { name: "Paste from clipboard" })).toBeVisible();
  await dropArea.getByRole("button", { name: "Add URL" }).click();
  const importDialog = page.getByRole("dialog", { name: "Add Remote Files" });
  await expect(importDialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await importDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await expect(page.getByText("No transfer tasks")).toBeVisible();
  await page.getByRole("button", { name: "Statistics" }).click();
  await page.getByRole("button", { name: "Sync bucket" }).click();
  await expect(page.getByRole("alert")).toContainText("Check your network");
  await page.getByRole("button", { name: "Retry sync" }).click();
  await expect(page.getByText("Storage overview", { exact: true })).toBeVisible();
  await page.getByText("Storage details", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Object types" })).toBeVisible();
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  await expect(page.getByLabel("Folder scope")).toBeHidden();
  const folderFilter = page.getByRole("button", { name: "Filter by folder", exact: true });
  await folderFilter.click();
  await expect(folderFilter).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Folder scope")).toBeVisible();
  await page
    .locator(".scan-controls")
    .getByRole("button", { name: "Scan Duplicates", exact: true })
    .click();
  await expect(page.getByText("No duplicate content found")).toBeVisible();
  await page
    .locator(".scan-controls")
    .getByRole("button", { name: "Scan Duplicates", exact: true })
    .click();
  await page.getByText("Same Files Group", { exact: true }).click();
  await page.getByRole("checkbox", { name: "one.txt" }).check();
  await expect(page.getByText("1 selected (4B)", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "two.txt" }).click();
  await expect(page.getByRole("checkbox", { name: "two.txt" })).not.toBeChecked();
  await page.getByRole("button", { name: "Delete Selected" }).click();
  await page
    .getByRole("dialog", { name: "Delete duplicate copies" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("1 deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bucket Download" }).click();
  const startBucketDownload = page.getByRole("button", { name: "Start Download" });
  await startBucketDownload.click();
  await expect(page.getByRole("alert")).toContainText("Please select save path first");
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).bucketDownload))
    .toBeUndefined();
  await page.getByRole("button", { name: "Select Folder" }).click();
  await expect(page.getByRole("textbox", { name: "Select Save Path" })).toHaveValue(
    "/tmp/r2client-fixture-only",
  );
  await startBucketDownload.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).bucketDownload))
    .toEqual({
      id: "alignment",
      prefix: "",
      directory: "chosen-local-folder",
    });
  await expect(page.getByRole("button", { name: "Enable schedule" })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const [label, content] of [
    ["Layout", settings.getByLabel("Theme")],
    ["Language", settings.getByRole("group", { name: "UI language" })],
    ["Upload", settings.getByText("FFmpeg status", { exact: true })],
    ["Sharing", settings.getByRole("group", { name: "Default link format" })],
    ["About", settings.getByText(`v${desktopVersion}`, { exact: true })],
  ] as const) {
    const item = sections.getByRole("button", { name: label, exact: true });
    await item.click();
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(content).toBeVisible();
  }

  await sections.getByRole("button", { name: "Upload", exact: true }).click();
  const image = settings.getByRole("group", { name: "Image", exact: true });
  const format = image.getByRole("combobox", { name: "Output format" });
  const processing = image.getByRole("switch", { name: "Image · Convert on upload" });
  await expect(format).toBeDisabled();
  await processing.check();
  await expect(format).toBeEnabled();
  await processing.uncheck();
  await expect(format).toBeDisabled();

  await sections.getByRole("button", { name: "Language", exact: true }).click();
  await expect(settings.getByRole("radio", { name: "English", exact: true })).toBeChecked();
  await settings.getByText("中文", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByText("English", { exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await sections.getByRole("button", { name: "Sharing", exact: true }).click();
  await settings.getByText("Markdown", { exact: true }).click();
  await expect(settings.getByRole("radio", { name: "Markdown", exact: true })).toBeChecked();
});

test("sorts across R2 pages while keeping folders first", async ({ page }) => {
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
              return {
                items: [
                  { kind: "folder", key: "z-folder/", size: 0, modified: "" },
                  { kind: "object", key: "aaa.txt", size: 50, modified: "2026-11-05T00:00:00Z" },
                  { kind: "object", key: "zzz.txt", size: 1, modified: "2026-11-09T00:00:00Z" },
                ],
              };
            }
            return {
              items: Array.from({ length: 200 }, (_, i) => ({
                kind: "object",
                key: "file-" + i + ".txt",
                size: 10,
                modified: "2026-11-06T00:00:00Z",
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
  const sort = page.getByRole("combobox", { name: "Sort files" });
  const firstFile = page.locator(".file-card").nth(1).locator(".file-name");
  await expect(sort).toHaveValue("modified-desc");
  await expect(firstFile).toHaveText("zzz.txt");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(folder).toHaveCount(0);
  for (const [value, name] of [
    ["modified-asc", "aaa.txt"],
    ["name-desc", "zzz.txt"],
    ["name-asc", "aaa.txt"],
    ["size-asc", "zzz.txt"],
    ["size-desc", "aaa.txt"],
  ] as const) {
    await sort.selectOption(value);
    await expect(page.locator(".file-card").first().locator(".file-name")).toHaveText("z-folder");
    await expect(firstFile).toHaveText(name);
  }
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

test("flat view loads nested files by prefix and keeps their object keys", async ({ page }) => {
  await page.addInitScript(() => {
    const profile = { id: "flat", label: "Flat fixture", bucket: "flat-fixture" };
    const item = (key: string, kind = "object", size = 4) => ({ key, kind, size, modified: "" });
    const older = item("photos/2025/trip.txt");
    const newer = item("photos/2026/day/trip.txt");
    const outside = item("other/trip.txt");
    const marker = item("photos/empty/", "object", 0);
    const downloads: { keys: string[]; prefix: string }[] = [];
    let fail = true;
    Object.assign(window, {
      flatDownloads: downloads,
      r2client: {
        capabilities: { desktop: true, folders: true },
        api: {
          snapshot: async () => ({
            profiles: [profile],
            connected: [profile.id],
            jobs: [],
            stages: [],
          }),
          index: async () => ({ objects: [outside], history: [], updated: "" }),
          list: async (_id: string, prefix: string, cursor?: string, recursive?: boolean) => {
            if (!recursive) {
              return {
                items: prefix
                  ? ["2025/", "2026/", "empty/"].map((key) => item(prefix + key, "folder", 0))
                  : [item("photos/", "folder", 0), item("other/", "folder", 0)],
              };
            }
            if (cursor) {
              if (fail) {
                fail = false;
                throw new Error("Listing interrupted");
              }
              return { items: [newer] };
            }
            return prefix
              ? { items: [older, marker], next: "nested" }
              : { items: [older, newer, marker, outside] };
          },
          download: async (
            _id: string,
            items: { key: string }[],
            _folder: string,
            prefix: string,
          ) => {
            downloads.push({ keys: items.map(({ key }) => key), prefix });
          },
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open folder photos" }).click();
  await page.getByRole("checkbox", { name: "Select 2025" }).check();
  const flat = page.getByRole("button", { name: "Flat view" });
  await expect(flat).toHaveAttribute("aria-pressed", "false");
  await flat.click();
  await expect(flat).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Batch actions" })).toHaveCount(0);
  await expect(page.getByText("Listing interrupted")).toBeVisible();
  await expect(page.locator(".file-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const older = page.getByRole("button", { name: "2025/trip.txt", exact: true });
  const newer = page.getByRole("button", { name: "2026/day/trip.txt", exact: true });
  await expect(older).toBeVisible();
  await expect(newer).toBeVisible();
  await expect(page.locator(".file-card")).toHaveCount(2);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(newer).toBeVisible();

  const sort = page.getByRole("combobox", { name: "Sort files" });
  await sort.selectOption("name-desc");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Search Files" });
  await search.getByRole("textbox").fill("2026");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(newer).toBeVisible();
  await expect(older).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(older).toBeVisible();
  await expect(sort).toHaveValue("name-desc");

  await page.getByRole("checkbox", { name: "Select 2026/day/trip.txt" }).check();
  await page.getByRole("button", { name: "Batch actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { flatDownloads: unknown }).flatDownloads),
    )
    .toEqual([{ keys: ["photos/2026/day/trip.txt"], prefix: "photos/" }]);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await search.getByRole("textbox").fill("trip");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Search results: trip")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select 2026/day/trip.txt" }).check();
  await flat.click();
  await expect(page.getByText("Search results: trip")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Batch actions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "empty", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All Files", exact: true }).click();
  await flat.click();
  await expect(
    page.getByRole("button", { name: "photos/2025/trip.txt", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "other/trip.txt", exact: true })).toBeVisible();
  await expect(page.locator(".file-card")).toHaveCount(3);
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

test("narrow zoom keeps navigation visible and shows download finalization separately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 790, height: 530 });
  await page.addInitScript(() => {
    localStorage.setItem("r2client-preferences", JSON.stringify({ zoom: 150 }));
    const profile = {
      id: "compact",
      label: "Narrow workspace fixture",
      bucket: "compact",
      accountId: "0".repeat(32),
      jurisdiction: "default",
      publicBase: "",
    };
    const stage = {
      id: "upload-source",
      name: "upload.txt",
      size: 4,
      type: "text/plain",
      modified: 0,
    };
    const job = {
      id: "download",
      profileId: profile.id,
      key: "download.txt",
      direction: "download",
      state: "running",
      done: 2,
      total: 4,
      created: "2026-11-09T00:00:00Z",
      updated: "2026-11-09T00:00:01Z",
    };
    const jobs = [job];
    let stages: (typeof stage)[] = [];
    Object.assign(window, {
      finishDownloadBytes: () => {
        job.done = job.total;
      },
      finishDownload: () => {
        job.state = "failed";
        Object.assign(job, { error: "Destination unavailable" });
      },
      r2client: {
        capabilities: { desktop: true, folders: true },
        api: {
          snapshot: async () => ({
            profiles: [profile],
            connected: [profile.id],
            jobs: structuredClone(jobs),
            stages: structuredClone(stages),
          }),
          index: async () => undefined,
          destinationPath: async () => "/Users/test/Downloads",
          list: async () => ({
            items: [{ key: "file.txt", kind: "object", size: 4, modified: "" }],
          }),
          pickSources: async () => {
            stages = [stage];
          },
          upload: async () => {
            stages = [];
            jobs.push({
              ...job,
              id: "upload",
              key: stage.name,
              direction: "upload",
              state: "queued",
              done: 0,
            });
            return 0;
          },
          job: async (id: string, action: string) => {
            if (id === job.id && action === "resume") job.state = "completed";
          },
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("status").filter({ hasText: "Downloading download.txt..." }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishDownloadBytes: () => void }).finishDownloadBytes(),
  );
  await expect(page.getByRole("status").filter({ hasText: "Saving download.txt…" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("button")).toHaveCount(5);
  expect(await nav.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("combobox", { name: "Sort files" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Flat view" })).toBeInViewport();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Narrow workspace fixture Private" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unselect all", exact: true })).toBeVisible();
  const card = page.locator(".file-card");
  const check = await card.getByRole("checkbox").boundingBox();
  const download = await card.getByRole("button", { name: "Download file.txt" }).boundingBox();
  expect(download!.x).toBeGreaterThan(check!.x + check!.width);
  const more = card.getByRole("button", { name: "More actions file.txt" });
  await more.click();
  await expect(card.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
  await more.click();
  const footer = page.locator(".status-bar");
  await expect(footer).toBeVisible();
  expect(await footer.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(531);
  await nav.getByRole("button", { name: "Upload" }).click();
  await page.getByRole("button", { name: "Browse files" }).click();
  await expect(page.getByRole("textbox", { name: "Upload name" })).toHaveValue("upload.txt");
  await page.getByRole("button", { name: "Back to file picker" }).click();
  await page.getByRole("button", { name: "View staging area" }).click();
  await expect(page.getByRole("textbox", { name: "Upload name" })).toHaveValue("upload.txt");
  await page.getByRole("button", { name: "View staging area" }).click();
  await expect(page.getByRole("button", { name: "Hide staging area" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Upload name" })).toHaveCount(1);
  await page.getByRole("button", { name: "Close staging area" }).click();
  await page.getByRole("button", { name: "Processing Settings" }).click();
  const processing = page.getByRole("dialog", { name: "Processing Settings" });
  await expect(processing.getByText("No images in current batch")).toBeVisible();
  await processing.getByRole("button", { name: "Other Settings" }).click();
  await expect(
    processing.getByRole("checkbox", { name: "Replace existing objects" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(processing).toBeHidden();
  await page.getByRole("button", { name: "Start Upload" }).click();
  await expect(nav.getByRole("button", { name: "Transfers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("upload.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("Saving file…")).toBeVisible();
  const list = page.locator(".transfers-list");
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => (window as unknown as { finishDownload: () => void }).finishDownload());
  await expect(page.getByText("Destination unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(list.getByText("Completed", { exact: true })).toBeVisible();
  const tabBounds = await nav.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const { top, width } = button.getBoundingClientRect();
      return { top, width };
    }),
  );
  expect(new Set(tabBounds.map(({ top }) => top)).size).toBe(1);
  expect(
    Math.max(...tabBounds.map(({ width }) => width)) -
      Math.min(...tabBounds.map(({ width }) => width)),
  ).toBeLessThan(1);

  await page.setViewportSize({ width: 500, height: 530 });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const sections = settings.getByRole("navigation", { name: "Settings sections" });
  await sections.getByRole("button", { name: "Download", exact: true }).click();
  await expect(
    settings.getByRole("button", { name: "Choose folder", exact: true }),
  ).toBeInViewport();
  const sectionBounds = await sections.boundingBox();
  const contentBounds = await settings
    .getByRole("region", { name: "Download Settings" })
    .boundingBox();
  expect(contentBounds!.y).toBeGreaterThanOrEqual(sectionBounds!.y + sectionBounds!.height - 1);
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Transfers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("bucket search exposes matching folders and keeps the file menu dismissible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const profile = { id: "search", label: "Search fixture", bucket: "search-fixture" };
    const image = { key: "trip.png", kind: "object", size: 8, modified: "2026-11-09T06:00:00Z" };
    const nested = { ...image, key: "references/trip/01.jpeg" };
    const folder = { ...image, key: "references/", kind: "folder", size: 0 };
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
          index: async () => ({ objects: [image, nested], history: [], updated: image.modified }),
          list: async (_id: string, prefix: string) => ({
            items: prefix ? [nested] : [folder, image],
          }),
        },
      },
    });
  });
  await page.goto("/");
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.click();
  let form = page.getByRole("dialog", { name: "Search Files" });
  await form.getByRole("textbox").fill("trip");
  await form.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Search results: trip")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open folder trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: /01\.jpeg/ })).toHaveCount(0);
  const preview = page.getByRole("button", { name: "Preview trip.png" });
  await preview.click({ button: "right" });
  await expect(page.getByRole("button", { name: "Save as…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Save as…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open folder trip" }).click();
  await expect(
    page.getByRole("navigation", { name: "Folder path" }).getByRole("button", { name: "trip" }),
  ).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("button", { name: "Preview 01.jpeg" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(0);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".list-head")).toContainText("Actions");
  await expect(page.locator(".file-list .file-name .list-date")).toBeVisible();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await search.click();
  form = page.getByRole("dialog", { name: "Search Files" });
  await form.getByRole("textbox").fill("01.jpeg");
  await form.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("button", { name: "Preview 01.jpeg" })).toBeVisible();
});

test("matches the transfer filters and keeps paused uploads actionable", async ({ page }) => {
  await page.addInitScript(() => {
    const profile = { id: "transfers", label: "Transfer fixture", bucket: "transfer-fixture" };
    const job = {
      id: "paused-upload",
      profileId: profile.id,
      key: "report.txt",
      direction: "upload",
      state: "paused",
      done: 0,
      total: 20,
      created: "2026-11-08T00:00:00Z",
      updated: "2026-11-08T00:00:00Z",
    };
    Object.assign(window, {
      r2client: {
        capabilities: { desktop: true, folders: true },
        api: {
          snapshot: async () => ({
            profiles: [profile],
            connected: [profile.id],
            jobs: [{ ...job }],
            stages: [],
            platform: "desktop",
          }),
          list: async () => ({ items: [] }),
          index: async () => undefined,
          job: async (id: string, action: string) => {
            if (id === job.id && action === "resume") job.state = "queued";
          },
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  const filters = page.getByRole("group", { name: "Transfer status" });
  await expect(filters.getByRole("button")).toHaveText([
    /^All\s*1$/,
    "Queued",
    "Uploading",
    "Completed",
    "Failed",
  ]);
  const row = page.locator(".transfer-row").filter({ hasText: "report.txt" });
  await expect(row.getByText("Paused", { exact: true })).toHaveCount(1);
  await expect(row.getByRole("progressbar")).toHaveAttribute("value", "0");
  await expect(row.getByRole("checkbox")).toHaveCount(0);
  await expect(row.getByText("Speed --", { exact: true })).toBeVisible();

  await filters.getByRole("button", { name: "Queued" }).click();
  await expect(page.getByText("No files in queue", { exact: true })).toBeVisible();
  await filters.getByRole("button", { name: /^All/ }).click();
  await row.getByRole("button", { name: "Resume", exact: true }).click();
  await filters.getByRole("button", { name: "Queued" }).click();
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});
