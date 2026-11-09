import piexif from "piexifjs";
import type { Preset } from "@r2client/core";

export function ffmpegArgs(source: string, output: string, p: Preset, category: string) {
  const images = ["jpg", "png", "webp", "avif"],
    audio = ["mp3", "aac", "ogg", "flac"],
    video = ["mp4", "webm", "avi", "mkv"];
  if (
    !(
      category === "image"
        ? images
        : category === "audio"
          ? audio
          : category === "video"
            ? video
            : []
    ).includes(p.format)
  )
    throw new Error("Format does not match the media type");
  const quality = Math.max(1, Math.min(100, Math.trunc(p.quality) || 80));
  const args = [
    "-nostdin",
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    "image2,image2pipe,jpeg_pipe,png_pipe,webp_pipe,bmp_pipe,tiff_pipe,mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mp3,aac,wav,flac,ogg,gif",
  ];
  if (p.autoRotate === false) args.push("-noautorotate");
  args.push("-i", source);
  if (category === "image" || p.stripMetadata) args.push("-map_metadata", "-1");
  if (category !== "audio" && (p.width || p.height)) {
    const w = Math.max(2, Math.min(8192, Math.trunc(p.width || 8192)));
    const h = Math.max(2, Math.min(8192, Math.trunc(p.height || 8192)));
    args.push(
      "-vf",
      "scale=w='min(iw," +
        w +
        ")':h='min(ih," +
        h +
        ")':force_original_aspect_ratio=decrease:force_divisible_by=2",
    );
  }
  const br =
    Math.max(16, Math.min(30000, Math.trunc(p.bitrate || (category === "video" ? 2500 : 192)))) +
    "k";
  if (category === "image") {
    args.push("-frames:v", "1", "-update", "1");
    if (p.format === "jpg") args.push("-q:v", String(Math.round(31 - quality * 0.29)));
    if (p.format === "webp") args.push("-c:v", "libwebp", "-quality", String(quality));
    if (p.format === "avif") {
      args.splice(args.indexOf("-update"), 2);
      args.push(
        "-c:v",
        "libaom-av1",
        "-still-picture",
        "1",
        "-crf",
        String(Math.round(55 - quality * 0.48)),
      );
    }
  }
  if (category === "audio") {
    args.push(
      "-vn",
      "-c:a",
      ({ mp3: "libmp3lame", aac: "aac", ogg: "libvorbis", flac: "flac" } as Record<string, string>)[
        p.format
      ]!,
    );
    if (p.format !== "flac") args.push("-b:a", br);
    if (p.sampleRate === 44100 || p.sampleRate === 48000) args.push("-ar", String(p.sampleRate));
  }
  if (category === "video") {
    const codec =
      p.format === "webm" || p.codec === "vp9"
        ? "libvpx-vp9"
        : p.codec === "h265"
          ? "libx265"
          : "libx264";
    args.push(
      "-c:v",
      codec,
      "-c:a",
      p.format === "webm" ? "libopus" : "aac",
      "-pix_fmt",
      "yuv420p",
    );
    if (p.rateMode === "cbr")
      args.push(
        "-b:v",
        br,
        "-minrate",
        br,
        "-maxrate",
        br,
        "-bufsize",
        String(parseInt(br, 10) * 2) + "k",
      );
    else
      args.push(
        "-crf",
        String(Math.round(48 - quality * 0.34)),
        ...(codec === "libvpx-vp9" ? ["-b:v", "0"] : []),
      );
    if (p.format === "mp4") args.push("-movflags", "+faststart");
  }
  return [...args, output];
}

// Read only JPEG header segments; APP1 uses a 16-bit length. Stop at the first scan.
export function jpegExif(header: Buffer) {
  if (header[0] !== 0xff || header[1] !== 0xd8) return;
  for (let offset = 2; offset + 4 <= header.length;) {
    if (header[offset++] !== 0xff) break;
    while (header[offset] === 0xff) offset++;
    const marker = header[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > header.length) break;
    const size = header.readUInt16BE(offset);
    if (size < 2 || offset + size > header.length) break;
    const body = header.subarray(offset + 2, offset + size);
    if (marker === 0xe1 && body.subarray(0, 6).equals(Buffer.from("Exif\0\0"))) return body;
    offset += size;
  }
}

export function restoreJpegExif(input: Buffer, output: Buffer, p: Preset) {
  const exif = jpegExif(input);
  if (!exif || p.metadataMode === "remove_all" || !p.metadataMode) return output;
  const tags = piexif.load(exif.toString("latin1"));
  if (p.metadataMode === "remove_gps") {
    tags.GPS = {};
    // The embedded thumbnail and vendor data are opaque and may carry their own location.
    delete tags.thumbnail;
    tags["1st"] = {};
    delete tags.Exif?.[piexif.ExifIFD.MakerNote];
  }
  if (p.autoRotate !== false) (tags["0th"] ??= {})[piexif.ImageIFD.Orientation] = 1;
  return Buffer.from(piexif.insert(piexif.dump(tags), output.toString("latin1")), "latin1");
}
