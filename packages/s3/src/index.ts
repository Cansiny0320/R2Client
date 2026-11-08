import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { checkKey, encodeKey, encodeSegment, GiB, MiB, profileEndpoint } from "@r2client/core";
import type { Credentials, Detail, Item, ObjectStore, Part, Profile } from "@r2client/core";

const time = (date?: Date) => date?.toISOString() ?? "";
export function createR2(profile: Profile, credentials: Credentials): ObjectStore {
  const client = new S3Client({
    region: "auto",
    endpoint: profileEndpoint(profile),
    forcePathStyle: true,
    credentials,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
  });
  return new S3Store(client, profile.bucket);
}

export class S3Store implements ObjectStore {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  private base(Key: string) {
    return { Bucket: this.bucket, Key: checkKey(Key) };
  }
  async list(
    Prefix: string,
    ContinuationToken?: string,
    recursive = false,
    abortSignal?: AbortSignal,
  ) {
    if (Prefix) checkKey(Prefix);
    const r = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix,
        ContinuationToken,
        Delimiter: recursive ? undefined : "/",
        MaxKeys: 200,
        EncodingType: "url",
      }),
      { abortSignal },
    );
    const decode = (s: string) => (r.EncodingType === "url" ? decodeURIComponent(s) : s);
    const objects: Item[] = (r.Contents ?? []).flatMap((x) =>
      x.Key
        ? [
            {
              key: decode(x.Key),
              kind: "object",
              modified: time(x.LastModified),
              size: x.Size ?? 0,
              etag: x.ETag,
              storageClass: x.StorageClass,
            },
          ]
        : [],
    );
    if (recursive) return { items: objects, next: r.NextContinuationToken };
    const folders: Item[] = (r.CommonPrefixes ?? []).flatMap((x) =>
      x.Prefix ? [{ key: decode(x.Prefix), kind: "folder", size: 0, modified: "" }] : [],
    );
    return {
      items: [...folders, ...objects.filter((x) => x.key !== Prefix)],
      next: r.NextContinuationToken,
    };
  }
  async head(key: string, abortSignal?: AbortSignal): Promise<Detail> {
    const r = await this.client.send(new HeadObjectCommand(this.base(key)), { abortSignal });
    return {
      key,
      kind: "object",
      size: r.ContentLength ?? 0,
      modified: time(r.LastModified),
      etag: r.ETag,
      type: r.ContentType,
      metadata: r.Metadata ?? {},
      storageClass: r.StorageClass,
      cacheControl: r.CacheControl,
      disposition: r.ContentDisposition,
    };
  }
  async put(
    key: string,
    Body: Uint8Array,
    ContentType: string,
    replace: boolean,
    abortSignal?: AbortSignal,
    Metadata?: Record<string, string>,
  ) {
    await this.client.send(
      new PutObjectCommand({
        ...this.base(key),
        Body,
        ContentType,
        Metadata,
        IfNoneMatch: replace ? undefined : "*",
      }),
      { abortSignal },
    );
  }
  async begin(key: string, ContentType: string, job: string, abortSignal?: AbortSignal) {
    const r = await this.client.send(
      new CreateMultipartUploadCommand({
        ...this.base(key),
        ContentType,
        Metadata: { "r2client-job": job },
      }),
      { abortSignal },
    );
    if (!r.UploadId) throw new Error("R2 did not return an upload ID");
    return r.UploadId;
  }
  async putPart(
    key: string,
    UploadId: string,
    PartNumber: number,
    Body: Uint8Array,
    abortSignal?: AbortSignal,
  ) {
    const r = await this.client.send(
      new UploadPartCommand({ ...this.base(key), UploadId, PartNumber, Body }),
      { abortSignal },
    );
    if (!r.ETag)
      throw new Error("Missing part ETag. In a browser expose ETag in the R2 CORS settings.");
    return r.ETag;
  }
  async parts(key: string, UploadId: string, abortSignal?: AbortSignal) {
    const parts: Part[] = [];
    let marker: string | undefined;
    do {
      const r = await this.client.send(
        new ListPartsCommand({ ...this.base(key), UploadId, PartNumberMarker: marker }),
        { abortSignal },
      );
      for (const p of r.Parts ?? [])
        if (p.PartNumber && p.ETag)
          parts.push({ number: p.PartNumber, etag: p.ETag, bytes: p.Size });
      const next = r.IsTruncated ? r.NextPartNumberMarker : undefined;
      if (next && next === marker) throw new Error("R2 part pagination stopped");
      marker = next;
    } while (marker);
    return parts;
  }
  async finish(key: string, UploadId: string, parts: Part[], abortSignal?: AbortSignal) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        ...this.base(key),
        UploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ ETag: p.etag, PartNumber: p.number })) },
      }),
      { abortSignal },
    );
  }
  async abort(key: string, UploadId: string) {
    try {
      await this.client.send(new AbortMultipartUploadCommand({ ...this.base(key), UploadId }));
    } catch (e) {
      if ((e as { name?: string }).name !== "NoSuchUpload") throw e;
    }
  }
  async read(key: string, offset = 0, IfMatch?: string, abortSignal?: AbortSignal) {
    const r = await this.client.send(
      new GetObjectCommand({
        ...this.base(key),
        Range: offset ? "bytes=" + offset + "-" : undefined,
        IfMatch,
      }),
      { abortSignal },
    );
    if (!r.Body || r.ContentLength === undefined) throw new Error("R2 response has no file body");
    return { etag: r.ETag, length: r.ContentLength, bytes: r.Body.transformToWebStream() };
  }
  async copy(
    source: string,
    key: string,
    etag?: string,
    update?: Detail,
    abortSignal?: AbortSignal,
  ) {
    const CopySource = this.bucket + "/" + encodeKey(source),
      before = await this.head(source, abortSignal);
    if (etag && before.etag !== etag) throw new Error("Source changed during copy");
    const from = update ?? before,
      size = before.size;
    const meta = {
      ContentType: from.type,
      Metadata: from.metadata,
      CacheControl: from.cacheControl,
      ContentDisposition: from.disposition,
    };
    if (size < 5 * GiB) {
      await this.client.send(
        new CopyObjectCommand({
          ...this.base(key),
          CopySource,
          CopySourceIfMatch: etag,
          ...(update ? { MetadataDirective: "REPLACE" as const, ...meta } : {}),
        }),
        { abortSignal },
      );
      return;
    }
    const start = await this.client.send(
      new CreateMultipartUploadCommand({ ...this.base(key), ...meta }),
      { abortSignal },
    );
    const UploadId = start.UploadId;
    if (!UploadId) throw new Error("R2 did not return a multipart copy ID");
    try {
      const parts: Part[] = [],
        step = Math.max(128 * MiB, Math.ceil(size / 10000 / MiB) * MiB);
      for (let i = 0, n = 1; i < size; i += step, n++) {
        const r = await this.client.send(
          new UploadPartCopyCommand({
            ...this.base(key),
            CopySource,
            CopySourceIfMatch: etag,
            CopySourceRange: "bytes=" + i + "-" + (Math.min(i + step, size) - 1),
            PartNumber: n,
            UploadId,
          }),
          { abortSignal },
        );
        if (!r.CopyPartResult?.ETag) throw new Error("R2 did not acknowledge copied part");
        parts.push({ number: n, etag: r.CopyPartResult.ETag });
      }
      await this.finish(key, UploadId, parts, abortSignal);
    } catch (e) {
      await this.abort(key, UploadId).catch(() => {});
      throw e;
    }
  }
  async remove(key: string, IfMatch?: string, abortSignal?: AbortSignal) {
    await this.client.send(new DeleteObjectCommand({ ...this.base(key), IfMatch }), {
      abortSignal,
    });
  }
  signed(key: string, expiresIn: number, filename?: string) {
    const disposition = filename
      ? "attachment; filename*=UTF-8''" + encodeSegment(filename)
      : undefined;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ ...this.base(key), ResponseContentDisposition: disposition }),
      { expiresIn },
    );
  }
}
