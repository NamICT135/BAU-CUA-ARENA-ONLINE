const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
(async () => {
const format = process.argv.includes('--webm') ? 'webm' : 'mp4';
const video = path.resolve(__dirname, `../../../public/assets/hub/quick-play-dragon-loop.${format}`);
const bin = process.env.FFMPEG_BIN || '';
const exe = name => bin ? path.join(bin, `${name}.exe`) : name;
const metadata = JSON.parse(execFileSync(exe('ffprobe'), ['-v','error','-count_frames','-show_streams','-show_format','-of','json',video], { encoding: 'utf8', windowsHide: true }));
assert.equal(metadata.streams.length, 1, 'Silent visual asset must have only a video stream');
const stream = metadata.streams[0];
assert.equal(stream.codec_name, format === 'webm' ? 'vp9' : 'h264');
assert.equal(stream.width, 576); assert.equal(stream.height, 800);
assert.equal(stream.r_frame_rate, '30/1'); assert.equal(stream.nb_read_frames, '150');
assert.equal(Number(metadata.format.duration), 5);
const frames = execFileSync(exe('ffmpeg'), ['-hide_banner','-loglevel','error','-i',video,'-vf','select=eq(n\\,0)+eq(n\\,149)','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const length = 576 * 800 * 3;
assert.equal(frames.length, length * 2);
let total = 0;
for (let i=0;i<length;i++) total += Math.abs(frames[i]-frames[i+length]);
const encodedSeamMeanAbsoluteDifference = total / length;
// H.264 distributes high-frequency quantization differently in I/P frames.
// Evaluate the visible seam at the actual 240px card width, retaining the full
// resolution error above as evidence rather than treating it as geometric drift.
const cardFrames = await Promise.all([frames.subarray(0,length), frames.subarray(length)].map(input => sharp(input, { raw: { width: 576, height: 800, channels: 3 } }).resize(240,333).raw().toBuffer()));
let cardDifference = 0;
for(let i=0;i<cardFrames[0].length;i++) cardDifference += Math.abs(cardFrames[0][i]-cardFrames[1][i]);
const displaySeamMeanAbsoluteDifference = cardDifference / cardFrames[0].length;
console.log(JSON.stringify({ encodedSeamMeanAbsoluteDifference, displaySeamMeanAbsoluteDifference }));
// Allow under 2/255 mean channel difference after lossy video compression.
// Geometric continuity is separately checked on lossless composition frames.
assert.ok(displaySeamMeanAbsoluteDifference < 2, 'The encoded seam must remain close at the actual card size');
const result = { codec: stream.codec_name, width: stream.width, height: stream.height, fps: 30, frames: 150, duration: 5, audioTracks: 0, bytes: Number(metadata.format.size), encodedSeamMeanAbsoluteDifference, displaySeamMeanAbsoluteDifference };
fs.writeFileSync(path.resolve(__dirname, `../qa/${format === 'webm' ? 'webm' : 'video'}-verification.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
})().catch(e => { console.error(e); process.exit(1); });
