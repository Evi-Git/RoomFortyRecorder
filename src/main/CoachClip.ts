import path from 'path';
import { promises as fsp } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import CloudClient from 'storage/CloudClient';
import { CloudMetadata, RendererVideo } from './types';
import {
  buildClipMetadata,
  getOBSFormattedDate,
  rendererVideoToMetadata,
  writeMetadataFile,
} from './util';
import ConfigService from 'config/ConfigService';
// Importing the queue sets fluent-ffmpeg's path to the bundled ffmpeg.exe.
import './VideoProcessQueue';

/**
 * [RoomFortyRecorder] Coaching clips for Discord: a short clip around the
 * moment being sent, so Discord can play it inline.
 *
 * Sending the whole recording didn't work: Discord's media proxy gives up on
 * files that size, and its inline player always starts at 0:00. So we cut
 * LEAD_SECONDS before the moment to LENGTH_SECONDS after, re-encode to 720p
 * H.264 + AAC (every recording codec becomes something Discord plays, and a
 * 30 s clip is a few MB), grab a thumbnail at the moment, and upload the clip
 * to the guild cloud like any other clip. It also shows up under Clips.
 */

export const LEAD_SECONDS = 5;
export const LENGTH_SECONDS = 30;

export type CoachClip = {
  videoName: string;
  thumbnail: string; // JPEG, base64
  start: number; // seconds into the source
};

const run = (command: ffmpeg.FfmpegCommand) =>
  new Promise<void>((resolve, reject) => {
    command
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

/**
 * Cut, encode and upload a coaching clip of `video` around `at` seconds.
 * `source` is a local path (preferred) or the cloud copy's URL.
 */
export const makeCoachClip = async (
  video: RendererVideo,
  source: string,
  at: number,
  onStage: (stage: 'cutting' | 'uploading') => void = () => {},
): Promise<CoachClip> => {
  const cfg = ConfigService.getInstance();
  const storageDir = cfg.get<string>('storagePath');
  if (!storageDir) throw new Error('Set a storage folder in Settings first.');

  const start = Math.max(0, Math.floor(at) - LEAD_SECONDS);
  const now = new Date();
  const name = `${getOBSFormattedDate(now)} - ${
    video.player?._name || 'Coaching'
  } - Coaching clip`.replace(/[\\/:*?"<>|]/g, '-');
  const videoPath = path.join(storageDir, `${name}.mp4`);
  const thumbPath = path.join(storageDir, `${name}.thumb.jpg`);

  onStage('cutting');
  // Seek before the input (fast), then re-encode for Discord.
  await run(
    ffmpeg(source)
      .inputOptions([`-ss ${start}`])
      .outputOptions([
        `-t ${LENGTH_SECONDS}`,
        '-map 0:v:0',
        // Track 1 carries every audio source unless someone re-routed them.
        '-map 0:a:0?',
        '-vf scale=-2:720',
        '-c:v libx264',
        '-preset veryfast',
        '-crf 24',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
      ])
      .output(videoPath),
  );

  // The frame being sent, for Discord's preview image.
  await run(
    ffmpeg(videoPath)
      .inputOptions([`-ss ${Math.min(at - start, LENGTH_SECONDS - 1)}`])
      .outputOptions(['-frames:v 1', '-vf scale=-2:540', '-q:v 4'])
      .output(thumbPath),
  );
  const thumbnail = (await fsp.readFile(thumbPath)).toString('base64');
  await fsp.unlink(thumbPath).catch(() => {});

  // A normal clip's metadata, so it appears under Clips too.
  const stat = await fsp.stat(videoPath);
  const metadata = buildClipMetadata(
    rendererVideoToMetadata({ ...video }),
    LENGTH_SECONDS,
    now,
    start,
    video.videoName,
  );
  metadata.size = stat.size;
  await writeMetadataFile(videoPath, metadata);

  onStage('uploading');
  const client = CloudClient.getInstance();
  await client.putFile(videoPath, -1, () => {});
  const cloudMetadata: CloudMetadata = {
    ...metadata,
    start: metadata.start || now.getTime(),
    uniqueHash: metadata.uniqueHash || '',
    videoName: name,
    videoKey: `${name}.mp4`,
  };
  await client.postVideo(cloudMetadata);

  return { videoName: name, thumbnail, start };
};
