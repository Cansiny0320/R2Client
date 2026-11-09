import type { Preset } from "@r2client/core";
import type { Tr } from "./common";

export type MediaCategory = "image" | "audio" | "video";
type Rule = { enabled: boolean; maxMiB?: number; preset: Preset };
export type MediaDefaults = Record<MediaCategory, Rule> & { timeoutMinutes: number };
export const mediaDefaults: MediaDefaults = {
  image: {
    enabled: false,
    preset: { format: "webp", quality: 80, autoRotate: true, metadataMode: "remove_all" },
  },
  video: {
    enabled: false,
    maxMiB: 100,
    preset: {
      format: "mp4",
      quality: 80,
      bitrate: 2500,
      codec: "h264",
      rateMode: "cbr",
      autoRotate: true,
    },
  },
  audio: { enabled: false, maxMiB: 50, preset: { format: "mp3", quality: 80, bitrate: 192 } },
  timeoutMinutes: 5,
};
export const mediaCategories = ["image", "video", "audio"] as const;
export const mediaLabel = (t: Tr, kind: MediaCategory) =>
  kind === "image"
    ? t("Images", "图片")
    : kind === "video"
      ? t("Video", "视频")
      : t("Audio", "音频");

export function MediaFields({
  category,
  value,
  set,
  t,
}: {
  category: MediaCategory;
  value: Preset;
  set: (patch: Partial<Preset>) => void;
  t: Tr;
}) {
  const formats: Preset["format"][] =
    category === "image"
      ? ["jpg", "png", "webp", "avif"]
      : category === "audio"
        ? ["mp3", "aac", "ogg", "flac"]
        : ["mp4", "webm", "avi", "mkv"];
  return (
    <>
      <label>
        {t("Output format", "输出格式")}
        <select
          value={value.format}
          onChange={(e) => set({ format: e.target.value as Preset["format"] })}
        >
          {formats.map((x) => (
            <option key={x} value={x}>
              {x.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      {category !== "audio" && (
        <>
          <label>
            {t("Quality", "质量")} · {value.quality}%
            <input
              type="range"
              min="1"
              max="100"
              value={value.quality}
              onChange={(e) => set({ quality: +e.target.value })}
            />
          </label>
          <div className="form-columns">
            <label>
              {t("Maximum width", "最大宽度")}
              <input
                type="number"
                min="2"
                max="8192"
                value={value.width ?? ""}
                onChange={(e) => set({ width: +e.target.value || undefined })}
              />
            </label>
            <label>
              {t("Maximum height", "最大高度")}
              <input
                type="number"
                min="2"
                max="8192"
                value={value.height ?? ""}
                onChange={(e) => set({ height: +e.target.value || undefined })}
              />
            </label>
          </div>
        </>
      )}
      {category === "video" && (
        <div className="form-columns">
          <label>
            {t("Video codec", "视频编码")}
            <select
              value={value.codec}
              onChange={(e) => set({ codec: e.target.value as Preset["codec"] })}
            >
              <option value="h264">H.264</option>
              <option value="h265">H.265</option>
              <option value="vp9">VP9</option>
            </select>
          </label>
          <label>
            {t("Bitrate mode", "码率模式")}
            <select
              value={value.rateMode}
              onChange={(e) => set({ rateMode: e.target.value as Preset["rateMode"] })}
            >
              <option value="vbr">VBR</option>
              <option value="cbr">CBR</option>
            </select>
          </label>
        </div>
      )}
      {(category === "audio" || value.rateMode === "cbr") && (
        <label>
          {t("Bitrate (kbps)", "码率（kbps）")}
          <input
            type="number"
            min="16"
            max="30000"
            value={value.bitrate ?? ""}
            onChange={(e) => set({ bitrate: +e.target.value || undefined })}
          />
        </label>
      )}
      {category === "audio" && (
        <label>
          {t("Sample rate", "采样率")}
          <select
            value={value.sampleRate ?? ""}
            onChange={(e) => set({ sampleRate: +e.target.value || undefined })}
          >
            <option value="">{t("Original", "保持原样")}</option>
            <option value="44100">44.1 kHz</option>
            <option value="48000">48 kHz</option>
          </select>
        </label>
      )}
      {category === "image" && (
        <label>
          {t("EXIF metadata", "EXIF 元数据")}
          <select
            value={value.format === "jpg" ? value.metadataMode : "remove_all"}
            disabled={value.format !== "jpg"}
            onChange={(e) => set({ metadataMode: e.target.value as Preset["metadataMode"] })}
          >
            <option value="remove_all">{t("Remove all", "移除全部")}</option>
            <option value="remove_gps">{t("Remove GPS only", "仅移除 GPS")}</option>
            <option value="keep_all">{t("Keep all", "保留全部")}</option>
          </select>
        </label>
      )}
      {category !== "audio" && (
        <label className="check">
          <input
            type="checkbox"
            checked={value.autoRotate}
            onChange={(e) => set({ autoRotate: e.target.checked })}
          />{" "}
          {t("Apply orientation", "自动修正方向")}
        </label>
      )}
    </>
  );
}

export function MediaRules({
  value,
  set,
  t,
}: {
  value: MediaDefaults;
  set: (value: MediaDefaults) => void;
  t: Tr;
}) {
  return (
    <>
      {mediaCategories.map((category) => {
        const rule = value[category];
        const change = (patch: Partial<Rule>) =>
          set({ ...value, [category]: { ...rule, ...patch } });
        return (
          <fieldset className="stack media-settings-group" key={category}>
            <legend>{mediaLabel(t, category)}</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => change({ enabled: e.target.checked })}
              />
              {t("Convert on upload", "上传时自动转码")}
            </label>
            {rule.enabled && (
              <>
                <MediaFields
                  category={category}
                  value={rule.preset}
                  set={(patch) => change({ preset: { ...rule.preset, ...patch } })}
                  t={t}
                />
                {rule.maxMiB !== undefined && (
                  <label>
                    {t("Skip files larger than (MiB)", "跳过超过此大小的文件（MiB）")}
                    <input
                      type="number"
                      min="1"
                      max="4096"
                      value={rule.maxMiB}
                      onChange={(e) =>
                        change({ maxMiB: Math.max(1, Math.min(4096, +e.target.value || 1)) })
                      }
                    />
                  </label>
                )}
              </>
            )}
          </fieldset>
        );
      })}
      <label>
        {t("Conversion timeout (minutes)", "转码超时（分钟）")}
        <input
          type="number"
          min="1"
          max="60"
          value={value.timeoutMinutes}
          onChange={(e) =>
            set({ ...value, timeoutMinutes: Math.max(1, Math.min(60, +e.target.value || 1)) })
          }
        />
      </label>
    </>
  );
}
