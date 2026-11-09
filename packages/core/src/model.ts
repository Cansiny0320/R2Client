export type Jurisdiction = "default" | "eu" | "fedramp";
export interface Profile {
  id: string;
  label: string;
  accountId: string;
  bucket: string;
  jurisdiction: Jurisdiction;
  publicBase: string;
  demo?: boolean;
  savedAccountId?: string;
}
export interface SavedAccount {
  id: string;
  label: string;
  accountId: string;
  jurisdiction: Jurisdiction;
}
export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}
export interface Connection extends Profile {
  credentials: Credentials;
  remember?: boolean;
  reuseCredentialsFrom?: string;
}
export interface Item {
  key: string;
  kind: "object" | "folder";
  size: number;
  modified: string;
  etag?: string;
  type?: string;
  storageClass?: string;
}
export interface Detail extends Item {
  metadata: Record<string, string>;
  cacheControl?: string;
  disposition?: string;
}
export interface Page {
  items: Item[];
  next?: string;
}
export interface Part {
  number: number;
  etag: string;
  digest?: string;
  bytes?: number;
}
export interface Version {
  etag?: string;
  length: number;
  bytes: ReadableStream<Uint8Array>;
}
export interface ObjectStore {
  list(
    prefix: string,
    cursor?: string,
    recursive?: boolean,
    signal?: AbortSignal,
    limit?: number,
  ): Promise<Page>;
  head(key: string, signal?: AbortSignal): Promise<Detail>;
  put(
    key: string,
    data: Uint8Array,
    type: string,
    replace: boolean,
    signal?: AbortSignal,
    metadata?: Record<string, string>,
  ): Promise<void>;
  begin(key: string, type: string, job: string, signal?: AbortSignal): Promise<string>;
  putPart(
    key: string,
    id: string,
    number: number,
    data: Uint8Array,
    signal?: AbortSignal,
  ): Promise<string>;
  parts(key: string, id: string, signal?: AbortSignal): Promise<Part[]>;
  finish(key: string, id: string, parts: Part[], signal?: AbortSignal): Promise<void>;
  abort(key: string, id: string): Promise<void>;
  read(key: string, offset?: number, etag?: string, signal?: AbortSignal): Promise<Version>;
  copy(
    source: string,
    target: string,
    etag?: string,
    detail?: Detail,
    signal?: AbortSignal,
  ): Promise<void>;
  remove(key: string, etag?: string, signal?: AbortSignal): Promise<void>;
  signed(key: string, seconds: number, filename?: string): Promise<string>;
}
export interface Source {
  id: string;
  name: string;
  size: number;
  type: string;
  modified: number;
  processed?: boolean;
}
export interface SourceReader extends Source {
  read(start: number, end: number): Promise<Uint8Array>;
}
export interface Sink {
  bytes(): Promise<number>;
  append(data: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  reset(): Promise<void>;
  remove(): Promise<void>;
}
export type JobState = "queued" | "running" | "paused" | "failed" | "completed" | "cancelled";
export type DownloadCompletion = "notify" | "reveal" | "none";
export interface UploadTuning {
  files: number;
  global: number;
  perFile: number;
  chunkMiB: number;
  thresholdMiB: number;
}
export interface Job {
  id: string;
  profileId: string;
  key: string;
  direction: "upload" | "download";
  state: JobState;
  total: number;
  done: number;
  created: string;
  updated: string;
  source?: Source;
  destination?: string;
  etag?: string;
  replace?: boolean;
  uploadId?: string;
  parts?: Part[];
  partSize?: number;
  uploadTuning?: UploadTuning;
  downloadBatch?: { id: string; count: number; action: DownloadCompletion };
  error?: string;
}
export interface Snapshot {
  profiles: Profile[];
  accounts?: SavedAccount[];
  connected: string[];
  jobs: Job[];
  stages: Source[];
  platform: "desktop" | "web";
}
export interface Index {
  updated: string;
  objects: Item[];
  history: { at: string; count: number; bytes: number }[];
}
export interface Mutation {
  kind: "copy" | "move" | "delete" | "metadata" | "folder";
  key: string;
  target?: string;
  metadata?: Record<string, string>;
  type?: string;
  cacheControl?: string;
  disposition?: string;
  expectedEtag?: string;
}
export interface Outcome {
  key: string;
  target?: string;
  ok: boolean;
  error?: string;
}
export interface Schedule {
  profileId: string;
  prefix: string;
  destination: string;
  minutes: number;
  enabled: boolean;
}
export interface Preset {
  format:
    | "jpg"
    | "png"
    | "webp"
    | "avif"
    | "mp3"
    | "aac"
    | "ogg"
    | "flac"
    | "mp4"
    | "webm"
    | "avi"
    | "mkv";
  quality: number;
  width?: number;
  height?: number;
  bitrate?: number;
  sampleRate?: number;
  codec?: "h264" | "h265" | "vp9";
  rateMode?: "cbr" | "vbr";
  stripMetadata?: boolean;
  autoRotate?: boolean;
  metadataMode?: "remove_all" | "remove_gps" | "keep_all";
  timeoutMinutes?: number;
}
export interface Driver {
  platform: "desktop" | "web";
  store(profile: Profile, credentials?: Credentials): ObjectStore;
  load<T>(key: string): Promise<T | undefined>;
  save<T>(key: string, value: T): Promise<void>;
  getSecret(id: string): Promise<Credentials | undefined>;
  setSecret(id: string, value: Credentials | undefined, remember: boolean): Promise<void>;
  source(id: string): Promise<SourceReader | undefined>;
  sink(job: Job): Promise<Sink>;
  fileMatches?(destination: string, item: Item): Promise<boolean>;
  safeToReplace?(destination: string): Promise<boolean>;
  pickDestination?(): Promise<string | undefined>;
  destinationPath?(id: string): string | undefined;
  pickSaveDestination?(name: string): Promise<{ directory: string; name: string } | undefined>;
  defaultDestination?(): Promise<string>;
  downloadCompleted?(destination: string, count: number, action: DownloadCompletion): Promise<void>;
  pickSources?(directory: boolean): Promise<Source[]>;
  importUrls(urls: string[]): Promise<Source[]>;
  disposeSource?(id: string): Promise<void>;
  convert?(id: string, preset: Preset, signal?: AbortSignal): Promise<Source>;
  ffmpegStatus?(): Promise<{ available: boolean; executable?: string }>;
  configureFfmpeg?(): Promise<void>;
  mediaUrl?(profileId: string, key: string, url: string): Promise<string> | string;
  openExternal?(url: string): Promise<void>;
  revealDestination?(id: string): Promise<void>;
}
export interface Api {
  snapshot(): Promise<Snapshot>;
  connect(input: Connection): Promise<void>;
  removeProfile(id: string): Promise<void>;
  forgetAccount(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  list(id: string, prefix: string, cursor?: string, recursive?: boolean): Promise<Page>;
  detail(id: string, key: string): Promise<Detail>;
  previewDocument(id: string, key: string, format: "text" | "pdf"): Promise<Uint8Array>;
  index(id: string): Promise<Index | undefined>;
  scan(id: string): Promise<Index>;
  duplicates(id: string, prefix: string): Promise<Item[][]>;
  mutate(id: string, actions: Mutation[]): Promise<Outcome[]>;
  links(
    id: string,
    key: string,
    seconds: number,
    mode: "public" | "signed" | "preview" | "download",
  ): Promise<string>;
  stage(sources: Source[]): Promise<void>;
  pickSources(directory: boolean): Promise<void>;
  importUrls(urls: string[]): Promise<void>;
  unstage(id: string): Promise<void>;
  upload(
    id: string,
    prefix: string,
    entries: { id: string; name: string; preset?: Preset }[],
    replace: boolean,
    concurrency: number | UploadTuning,
    skipDuplicates?: boolean,
  ): Promise<number>;
  download(
    id: string,
    keys: Item[],
    directory: string,
    prefix: string,
    replace: boolean,
    options?: { completion: DownloadCompletion; parallel: number },
  ): Promise<void>;
  pickDestination(): Promise<string | undefined>;
  destinationPath(id: string): Promise<string | undefined>;
  downloadAs(
    id: string,
    item: Item,
    replace: boolean,
    options?: { completion: DownloadCompletion; parallel: number },
  ): Promise<boolean>;
  attach(id: string, source: Source): Promise<void>;
  job(id: string, action: "pause" | "resume" | "cancel" | "remove"): Promise<void>;
  clearCompleted(): Promise<void>;
  schedules(): Promise<Schedule[]>;
  schedule(value: Schedule): Promise<void>;
  syncDirectory(id: string, prefix: string, directory: string): Promise<number>;
  convert(id: string, preset: Preset, keepOriginal?: boolean): Promise<void>;
  ffmpegStatus(): Promise<{ available: boolean; executable?: string }>;
  configureFfmpeg(): Promise<void>;
  revealDestination(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
export type Call<K extends keyof Api = keyof Api> = {
  [P in K]: { method: P; args: Parameters<Api[P]> };
}[K];
export type Invoke = <K extends keyof Api>(call: Call<K>) => ReturnType<Api[K]>;
export const METHODS: ReadonlySet<keyof Api> = new Set([
  "snapshot",
  "connect",
  "removeProfile",
  "forgetAccount",
  "reorder",
  "list",
  "detail",
  "previewDocument",
  "index",
  "scan",
  "duplicates",
  "mutate",
  "links",
  "stage",
  "pickSources",
  "importUrls",
  "unstage",
  "upload",
  "download",
  "pickDestination",
  "destinationPath",
  "downloadAs",
  "attach",
  "job",
  "clearCompleted",
  "schedules",
  "schedule",
  "syncDirectory",
  "convert",
  "ffmpegStatus",
  "configureFfmpeg",
  "revealDestination",
  "openExternal",
]);
export function remote(invoke: Invoke): Api {
  return Object.fromEntries(
    [...METHODS].map((method) => [
      method,
      (...args: unknown[]) => invoke({ method, args } as Call),
    ]),
  ) as unknown as Api;
}
