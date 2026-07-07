import type { ExtractedContentType, SegmentType } from '../gql/graphql';

export type ExtractedSegment = {
  type: SegmentType;
  text: string;
  page?: number;
  tier?: string;
  startMs?: number | undefined;
  endMs?: number | undefined;
};

// Mirrors nabu's ExtractedContentInput GraphQL input, but as a discriminated union.
// The enum literals come from the generated client via Extract, so schema drift
// (a renamed or removed content type) surfaces as a compile error here.
export type ExtractedContent =
  | { contentType: Extract<ExtractedContentType, 'TEXT'>; text: string }
  | { contentType: Extract<ExtractedContentType, 'PDF' | 'ELAN'>; segments: ExtractedSegment[] };
