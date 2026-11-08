import { expect, test } from "@playwright/test";
test("explores the static app, stages an upload and moves an object", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "demo-assets Demo" })).toBeVisible();
  if (process.env.R2CLIENT_UI_SNAPSHOT)
    await page.screenshot({ path: process.env.R2CLIENT_UI_SNAPSHOT });
  await page.getByRole("button", { name: "Open folder documents" }).click();
  await expect(page.getByRole("button", { name: "guide.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "guide.txt", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "guide.txt" })).toBeVisible();
  await expect(page.getByText("Welcome to the R2Client demo.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".file-list")).toBeVisible();
  await page.getByRole("button", { name: "Upload files", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "new-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("local demo transfer"),
    });
  await expect(page.getByRole("textbox", { name: "Upload name" })).toHaveValue("new-note.txt");
  await expect(page.getByRole("button", { name: "Convert media", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start upload", exact: true }).click();
  await expect(page.locator(".transfer-row").getByText("Completed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("button", { name: "new-note.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions new-note.txt" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Name or pattern" }).fill("renamed.txt");
  await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("1 succeeded · 0 failed")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "renamed.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Storage statistics", exact: true }).click();
  await page.getByRole("button", { name: "Sync bucket", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Object types" })).toBeVisible();
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable schedule", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("connection settings, narrow navigation and no renderer errors", async ({ page }) => {
  await page.setViewportSize({ width: 470, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Add storage bucket", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Secret Access Key")).toBeVisible();
  await expect(modal.getByText("Credentials stay in this tab.", { exact: false })).toBeVisible();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
});
test("uses S3 in the browser and does not persist an access key", async ({ page }) => {
  const account = "a".repeat(32),
    key = "fixture_browser_access",
    secret = "fixture_browser_secret";
  const origin = "http://127.0.0.1:" + (process.env.R2CLIENT_SMOKE_PORT || 42931);
  const methods: string[] = [];
  await page.route("https://" + account + ".r2.cloudflarestorage.com/**", async (route) => {
    const req = route.request();
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "ETag",
      "Content-Type": "application/xml",
    };
    if (req.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Headers":
            req.headers()["access-control-request-headers"] || "Authorization",
        },
      });
      return;
    }
    methods.push(req.headers().authorization || "");
    await route.fulfill({
      status: 200,
      headers,
      body: '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated><Contents><Key>from-s3.txt</Key><ETag>"fake"</ETag><Size>4</Size><LastModified>2026-11-08T00:00:00Z</LastModified></Contents></ListBucketResult>',
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add storage bucket", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Cloudflare Account ID").fill(account);
  await modal.getByLabel("Bucket name", { exact: true }).fill("example-test");
  await modal.getByLabel("Access Key ID").fill(key);
  await modal.getByLabel("Secret Access Key").fill(secret);
  await modal.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "from-s3.txt", exact: true })).toBeVisible();
  expect(methods).not.toHaveLength(0);
  expect(methods.every((value) => value.includes("Credential=" + key + "/"))).toBeTruthy();
  const stored = await page.evaluate(
    () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
  );
  expect(stored).not.toContain(key);
  expect(stored).not.toContain(secret);
  await page.reload();
  await expect(page.getByText("Connect this bucket to view its files")).toBeVisible();
});
