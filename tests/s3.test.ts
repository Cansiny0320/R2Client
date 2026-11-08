import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { S3Store } from "../packages/s3/src/index";
const require = createRequire(new URL("../packages/s3/package.json", import.meta.url));
const { S3Client } =
  require("@aws-sdk/client-s3") as typeof import("../packages/s3/node_modules/@aws-sdk/client-s3");
test("S3 adapter signs list, encoded paths, byte ranges and shares", async (t) => {
  const paths: { url: string; range?: string; auth?: string }[] = [];
  const server = createServer((req, res) => {
    paths.push({ url: req.url ?? "", range: req.headers.range, auth: req.headers.authorization });
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.searchParams.get("list-type") === "2") {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextContinuationToken>page+2</NextContinuationToken><Contents><Key>folder%2Fa%2B%25.txt</Key><LastModified>2026-11-08T00:00:00Z</LastModified><ETag>"fixture"</ETag><Size>5</Size><StorageClass>STANDARD</StorageClass></Contents><CommonPrefixes><Prefix>folder%2F</Prefix></CommonPrefixes></ListBucketResult>',
      );
    } else if (req.method === "GET") {
      res.writeHead(206, {
        "Content-Length": "3",
        "Content-Range": "bytes 2-4/5",
        "Content-Type": "text/plain",
        ETag: '"fixture"',
      });
      res.end("cde");
    } else {
      res.writeHead(200, {
        "Content-Length": "5",
        "Content-Type": "text/plain",
        ETag: '"fixture"',
        "Last-Modified": "Sun, 08 Nov 2026 00:00:00 GMT",
      });
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const client = new S3Client({
    region: "auto",
    endpoint: "http://127.0.0.1:" + addr.port,
    forcePathStyle: true,
    credentials: { accessKeyId: "fixture-access", secretAccessKey: "fixture-secret" },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  t.after(() => client.destroy());
  const store = new S3Store(client, "test-bucket"),
    result = await store.list("folder/", "first+page");
  assert.equal(result.next, "page+2");
  assert.ok(result.items.some((x) => x.key === "folder/a+%.txt"));
  const get = await store.read("folder/a+%.txt", 2, '"fixture"');
  assert.equal(await new Response(get.bytes).text(), "cde");
  assert.match(paths[0]?.auth ?? "", /^AWS4-HMAC-SHA256 Credential=fixture-access/);
  assert.match(paths[0]?.url ?? "", /continuation-token=first%2Bpage/);
  assert.match(paths[1]?.url ?? "", /\/folder\/a%2B%25\.txt/);
  assert.equal(paths[1]?.range, "bytes=2-");
  const link = new URL(await store.signed("folder/a+%.txt", 900, "a+%.txt"));
  assert.equal(link.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(link.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(link.searchParams.get("response-content-disposition") ?? "", /attachment/);
});
