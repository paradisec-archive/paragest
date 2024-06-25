import { execSync } from 'node:child_process';

import { z } from 'zod';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const GeneralTrack = z.object({
  '@type': z.literal('General'),
  VideoCount: z.coerce.number().optional(),
  AudioCount: z.coerce.number().optional(),
  FileExtension: z.string(),
  Format: z.string(),
  FileSize: z.coerce.number(),
  Duration: z.coerce.number(),
  OverallBitRate_Mode: z.string().optional(),
  OverallBitRate: z.coerce.number(),
  FrameRate: z.coerce.number().transform((val) => Math.round(val)).optional(),
  FrameCount: z.coerce.number().optional(),
  StreamSize: z.coerce.number().optional(),
  IsStreamable: z
    .string()
    .transform((value) => value === 'Yes')
    .optional(),
  CodecID: z.string().optional(),
});

const VideoTrack = z.object({
  '@type': z.literal('Video'),
  StreamOrder: z.coerce.number(),
  ID: z.coerce.number(),
  Format: z.string(),
  CodecID: z.string(),
  Duration: z.coerce.number(),
  BitRate_Mode: z.string().optional(),
  BitRate: z.coerce.number().optional(),
  Width: z.coerce.number(),
  Height: z.coerce.number(),
  Sampled_Width: z.coerce.number().optional(),
  Sampled_Height: z.coerce.number().optional(),
  PixelAspectRatio: z.coerce.number(),
  DisplayAspectRatio: z.coerce.number(),
  Rotation: z.coerce.number().optional(),
  FrameRate_Mode: z.string(),
  FrameRate: z.coerce.number(),
  FrameRate_Num: z.coerce.number().optional(),
  FrameRate_Den: z.coerce.number().optional(),
  FrameCount: z.coerce.number(),
  ColorSpace: z.string(),
  BitDepth: z.coerce.number(),
  ScanType: z.string(),
  Compression_Mode: z.string().optional(),
  StreamSize: z.coerce.number().optional(),
});

const AudioTrack = z.object({
  '@type': z.literal('Audio'),
  StreamOrder: z.coerce.number().optional(),
  ID: z.coerce.number().optional(),
  Format: z.string(),
  Format_Settings_Endianness: z.string().optional(),
  Format_Settings_Sign: z.string().optional(),
  CodecID: z.string().optional(),
  Duration: z.coerce.number(),
  BitRate_Mode: z.string(),
  BitRate: z.coerce.number().optional(),
  Channels: z.coerce.number(),
  ChannelPositions: z.string().optional(),
  ChannelLayout: z.string().optional(),
  SamplingRate: z.coerce.number(),
  SamplingCount: z.coerce.number(),
  BitDepth: z.coerce.number().optional(),
  StreamSize: z.coerce.number().optional(),
});

const OtherTrack = z.object({
  '@type': z.literal('General'),
  ID: z.coerce.number().optional(),
  Format: z.string(),
});

const MediaTrack = z.discriminatedUnion('@type', [GeneralTrack, VideoTrack, AudioTrack, OtherTrack]);

export const MediaInfoSchema = z.object({
  creatingLibrary: z.object({
    name: z.literal('MediaInfoLib'),
    version: z.string(),
    url: z.string().url(),
  }),
  media: z.object({
    '@ref': z.string(),
    track: z.array(MediaTrack),
  }),
});

export const lookupMimetypeFromExtension = (extension: string) => {
  switch (extension) {
    // /////////////////
    // Audio
    // /////////////////
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/vnd.wav';

    // /////////////////
    // Video
    // /////////////////

    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mpg':
      return 'video/mpeg';
    case 'dv':
      return 'video/x-dv';
    case 'mkv':
      return 'video/x-matroska';
    case 'mxf':
      return 'application/mxf';
    case 'mts':
      return 'video/mpt2';
    case 'avi':
      return 'video/x-msvideo';

    // We aren't going to accept these
    // case '3gp':

    // /////////////////
    // Images
    // /////////////////
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'tif':
      return 'image/tiff';
    case 'webp':
      return 'image/webp';

    // /////////////////
    // Other
    // /////////////////
    case 'pdf':
      return 'application/pdf';
    case 'eaf':
      return 'application/eaf+xml';
    case 'csv':
      return 'text/csv';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'rtf':
      return 'text/rtf';
    case 'txt':
      return 'text/plain';
    case 'zip':
      return 'application/zip';

    // /////////////////
    // Here for later as we deal with these
    // case 'annis':
    // case 'cha':
    // case 'TextGrid':
    // case 'lbl':
    // case 'tab':
    // case 'version':
    //   return 'text/plain';
    //
    // case 'srt':
    //   return 'application/x-subrip';
    //
    // case 'flextext':
    //   return 'application/flextext+xml';
    // case 'kml':
    //   return 'application/vnd.google-earth.kml+xml';
    // case 'idmi':
    //   return 'application/idmi+xml';
    // case 'ixt':
    //   return 'application/ixt+xml';
    // case 'trs':
    //   return 'application/trs+xml';
    // case 'xml':
    //   return 'text/xml';
    //
    // case 'html':
    //   return 'text/html';
    // case 'xhtml':
    //   return 'application/xhtml+xml';
    //

    // case 'ods':
    //   return 'application/vnd.oasis.opendocument.spreadsheet';
    //
    // case 'odt':
    //   return 'application/vnd.oasis.opendocument.text';
    // case 'tex':
    //   return 'text/x-tex';
    //
    //
    //
    // case 'iso':
    //   return 'application/x-iso9660-image';

    default:
      return null;
  }
};

const s3 = new S3Client();

export const getMediaMetadata = async (bucketName: string, objectKey: string) => {
  const getObjectCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  });

  const signedUrl = await getSignedUrl(s3, getObjectCommand, { expiresIn: 300 });

  const command = `mediainfo --output=JSON '${signedUrl}'`;

  const output = execSync(command, { encoding: 'utf-8' });
  console.debug('MediaInfo output:', output);
  const metadata = MediaInfoSchema.parse(JSON.parse(output));
  console.debug('Metadata:', JSON.stringify(metadata, null, 2));

  const general = metadata.media.track.find((track) => track['@type'] === 'General');
  if (!general) {
    throw new Error('No general track found');
  }
  if (general['@type'] !== 'General') {
    throw new Error('Should never happen, just for TS');
  }

  const audio = metadata.media.track.find((track) => track['@type'] === 'Audio');
  if (audio && audio['@type'] !== 'Audio') {
    throw new Error('Should never happen, just for TS');
  }
  const video = metadata.media.track.find((track) => track['@type'] === 'Video');
  if (video && video['@type'] !== 'Video') {
    throw new Error('Should never happen, just for TS');
  }

  return {
    channels: audio?.Channels,
    duration: general.Duration,
    samplerate: audio?.SamplingRate,
    bitrate: general.OverallBitRate,
    fps: video?.FrameRate,
    other: {
      bitDepth: video?.BitDepth,
      scanType: video?.ScanType,
      generalFormat: general.Format,
      generalCodecId: general.CodecID,
      videoCodecId: video?.CodecID,
      audioCodecId: audio?.CodecID,
    }
  };
};
