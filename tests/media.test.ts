import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ffmpegArgs } from "../apps/desktop/src/media";

const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_BIN;
test("native media presets reject mismatched formats and disable network input", () => {
  assert.throws(() =>
    ffmpegArgs("test.png", "output.mp3", { format: "mp3", quality: 80 }, "image"),
  );
  const args = ffmpegArgs(
    "test.mp4",
    "output.webm",
    { format: "webm", quality: 80, height: 720 },
    "video",
  );
  assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
  assert.equal(args[args.indexOf("-c:v") + 1], "libvpx-vp9");
  assert.ok(args.includes("output.webm"));
});
test(
  "FFmpeg converts fixture images, audio and video through the desktop presets",
  { skip: !ffmpeg },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "r2client-media-"));
    t.after(async () => {
      for (const name of [
        "image.webp",
        "fixture.wav",
        "fixture.mp3",
        "fixture.mp4",
        "fixture.webm",
      ])
        await rm(path.join(root, name), { force: true });
      await rmdir(root);
    });
    const png = fileURLToPath(new URL("../apps/desktop/build/icon.png", import.meta.url));
    const webp = path.join(root, "image.webp");
    await exec(
      ffmpeg!,
      ffmpegArgs(
        png,
        webp,
        { format: "webp", quality: 75, width: 128, height: 128, stripMetadata: true },
        "image",
      ),
      { windowsHide: true, timeout: 15000 },
    );
    assert.equal((await readFile(webp)).subarray(8, 12).toString("ascii"), "WEBP");
    const wave = Buffer.alloc(44 + 44100 * 2);
    wave.write("RIFF", 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(44100, 24);
    wave.writeUInt32LE(88200, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write("data", 36);
    wave.writeUInt32LE(88200, 40);
    for (let i = 0; i < 44100; i++)
      wave.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 44100)), 44 + i * 2);
    const wav = path.join(root, "fixture.wav"),
      mp3 = path.join(root, "fixture.mp3");
    await writeFile(wav, wave);
    await exec(
      ffmpeg!,
      ffmpegArgs(
        wav,
        mp3,
        { format: "mp3", quality: 80, bitrate: 128, sampleRate: 44100 },
        "audio",
      ),
      { windowsHide: true, timeout: 15000 },
    );
    const bytes = await readFile(mp3);
    assert.equal(bytes.subarray(0, 3).toString("ascii"), "ID3");
    assert.ok(bytes.length < wave.length);
    const mp4 = path.join(root, "fixture.mp4"),
      webm = path.join(root, "fixture.webm");
    await exec(
      ffmpeg!,
      [
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=green:s=96x64:r=12",
        "-t",
        "0.4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        mp4,
      ],
      { windowsHide: true, timeout: 15000 },
    );
    await exec(
      ffmpeg!,
      ffmpegArgs(mp4, webm, { format: "webm", quality: 70, height: 48, codec: "vp9" }, "video"),
      { windowsHide: true, timeout: 15000 },
    );
    assert.deepEqual([...(await readFile(webm)).subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  },
);
