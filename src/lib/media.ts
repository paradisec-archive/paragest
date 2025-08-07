import { z } from 'zod';
import { execute } from './command';

const GeneralTrack = z.object({
  '@type': z.literal('General'),

  Duration: z.coerce.number(),
  OverallBitRate: z.coerce.number(),
  Format: z.string(),
  CodecID: z.string().optional(),
});

const VideoTrack = z.object({
  '@type': z.literal('Video'),

  FrameRate_Mode: z.enum(['VFR', 'CFR']).optional(),
  FrameRate: z.coerce.number().optional(),
  BitDepth: z.coerce.number().optional(),
  ScanType: z.string().optional(),
  CodecID: z.string().optional(),
});

const AudioTrack = z.object({
  '@type': z.literal('Audio'),

  Channels: z.coerce.number(),
  SamplingRate: z.coerce.number(),
  CodecID: z.string().optional(),
});

const TextTrack = z.object({
  '@type': z.literal('Text'),
  Format: z.string().optional(),
});

const OtherTrack = z.object({
  '@type': z.literal('Other'),
  Format: z.string().optional(),
});

const ImageTrack = z.object({
  '@type': z.literal('Image'),
  Format: z.string(),
});

const MenuTrack = z.object({
  '@type': z.literal('Menu'),
  Format: z.string().optional(),
});

const MaxTrack = z.object({
  '@type': z.literal('Max'),
  Format: z.string().optional(),
});

const MediaTrack = z.discriminatedUnion('@type', [GeneralTrack, VideoTrack, AudioTrack, OtherTrack, ImageTrack, TextTrack, MenuTrack, MaxTrack]);

const MediaInfoSchema = z.object({
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
      return 'audio/wav';

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
      return 'video/matroska';
    case 'mxf':
      return 'application/mxf';
    case 'mts':
      return 'video/mp2t';
    case 'avi':
      return 'video/x-msvideo';
    case 'vob':
      return 'video/x-ms-vob';

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
    case 'odt':
      return 'application/vnd.oasis.opendocument.text';
    case 'rtf':
      return 'text/rtf';
    case 'srt':
      return 'application/x-subrip';
    case 'txt':
      return 'text/plain';
    case 'zip':
      return 'application/zip';
    case 'imdi':
      return 'application/imdi+xml';
    case 'cmdi':
      return 'application/cmdi+xml';
    case 'opex':
      return 'application/opex+xml';

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
    // case 'flextext':
    //   return 'application/flextext+xml';
    // case 'kml':
    //   return 'application/vnd.google-earth.kml+xml';
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
    // case 'tex':
    //   return 'text/x-tex';
    //
    // case 'iso':
    //   return 'application/x-iso9660-image';

    default:
      return null;
  }
};

export const getMediaMetadata = async (filename: string, event: Record<string, string | number | object>) => {
  console.log('🪚 ⭕', event);
  console.log('🪚 ⭕', filename);
  console.log('🪚 🔲');
  const output = execute(`mediainfo --output=JSON '${filename}'`, event);
  console.log('🪚 💜');
  execute('ls -lR /mnt/efs', event);

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
    // If we are missing framerate and it is VFR we set 0 as this is special in nabu
    fps: video?.FrameRate ? Math.round(video.FrameRate) : (video?.FrameRate_Mode === 'VFR' ? 0 : null),
    other: {
      bitDepth: video?.BitDepth,
      scanType: video?.ScanType || 'Progressive',
      generalFormat: general.Format,
      generalCodecId: general.CodecID,
      videoCodecId: video?.CodecID,
      audioCodecId: audio?.CodecID,
    },
  };
};
