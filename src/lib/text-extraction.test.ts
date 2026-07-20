import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as Sentry from '@sentry/aws-serverless';
import { describe, expect, it, vi } from 'vitest';

import { extractContent } from './text-extraction.js';

vi.mock('@sentry/aws-serverless', { spy: true });

describe('extractContent', () => {
  it('wraps plain text files as TEXT content', async () => {
    const content = await extractContent('samples/sample.txt', 'txt');

    expect(content).toEqual({ contentType: 'TEXT', text: 'MOO\nalkigaslgjas\n' });
  });

  it('returns null when a file yields no text at all', async () => {
    const content = await extractContent('samples/empty.txt', 'txt');

    expect(content).toBeNull();
  });

  describe('PDF files', () => {
    it('extracts one PAGE segment per page, dropping whitespace-only pages but keeping true page numbers', async () => {
      const content = await extractContent('samples/multipage.pdf', 'pdf');

      expect(content).toEqual({
        contentType: 'PDF',
        segments: [
          { type: 'PAGE', text: 'First page words', page: 1 },
          { type: 'PAGE', text: 'Third page words', page: 3 },
        ],
      });
    });

    it('extracts a single-page PDF as one PAGE segment without the flat-text page separators', async () => {
      const content = await extractContent('samples/sample.pdf', 'pdf');

      expect(content).toEqual({ contentType: 'PDF', segments: [{ type: 'PAGE', text: 'Test', page: 1 }] });
    });

    it('returns null for a PDF with no text layer', async () => {
      const content = await extractContent('samples/no-text.pdf', 'pdf');

      expect(content).toBeNull();
    });
  });

  describe('ELAN (.eaf) files', () => {
    it('extracts one TIME_ALIGNED_ANNOTATION segment per annotation across all tiers, in time order, with verbatim tier IDs', async () => {
      const content = await extractContent('samples/sample.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      const { segments } = content;

      // sample.eaf has 23 ALIGNABLE_ANNOTATIONs across three time-alignable tiers
      // plus 20 REF_ANNOTATIONs across two language tiers
      expect(segments).toHaveLength(43);
      expect(new Set(segments.map((s) => s.tier))).toEqual(
        new Set(['Person1 (Utterance)', 'marker', 'Person1 (Chunk)', 'Person1 (ChunkLanguage)', 'Person1 (Language)']),
      );
      expect(segments.every((s) => s.type === 'TIME_ALIGNED_ANNOTATION')).toBe(true);

      expect(segments[0]).toEqual({ type: 'TIME_ALIGNED_ANNOTATION', text: 'convo start', tier: 'marker', startMs: 830, endMs: 5200 });
      expect(segments[1]).toEqual({ type: 'TIME_ALIGNED_ANNOTATION', text: 'How do you read this?', tier: 'Person1 (Utterance)', startMs: 1040, endMs: 2330 });
      expect(segments[2]).toEqual({ type: 'TIME_ALIGNED_ANNOTATION', text: 'How do you read this?', tier: 'Person1 (Chunk)', startMs: 1040, endMs: 2330 });

      // Ref-annotations carry the interval of the alignable annotation they reference:
      // a38 (ChunkLanguage) refs chunk a26, a50 (Language) refs utterance a1 — both 1040→2330
      expect(segments[3]).toEqual({ type: 'TIME_ALIGNED_ANNOTATION', text: 'en', tier: 'Person1 (ChunkLanguage)', startMs: 1040, endMs: 2330 });
      expect(segments[4]).toEqual({ type: 'TIME_ALIGNED_ANNOTATION', text: 'en', tier: 'Person1 (Language)', startMs: 1040, endMs: 2330 });

      const starts = segments.map((s) => s.startMs);
      expect(starts).toEqual([...starts].sort((a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY)));
    });

    it('widens unanchored time slots to the nearest anchored slots in TIME_ORDER', async () => {
      const content = await extractContent('samples/dense.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      const { segments } = content;

      // "quick" (a411) spans ts39→ts40, both unanchored: the start widens backwards
      // to ts38 (8000) and the end widens forwards to ts43 (8000)
      expect(segments).toContainEqual({ type: 'TIME_ALIGNED_ANNOTATION', text: 'quick', tier: 'words-timesub', startMs: 8000, endMs: 8000 });

      // Every annotation in the fixture — alignable or ref — resolves to a concrete interval
      expect(segments.every((s) => s.startMs !== undefined && s.endMs !== undefined && s.endMs >= s.startMs)).toBe(true);
    });

    it('gives symbolic-subdivision siblings the full parent interval, resolving multi-level ref chains', async () => {
      const content = await extractContent('samples/dense.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      const { segments } = content;

      // The first utterance a1 ("The quick brown fox 001", 2000→5000) subdivides
      // symbolically into words a2395–a2399; each sibling carries a1's whole span —
      // even division is presentational in ELAN, not data
      const firstUtteranceWords = segments.filter((s) => s.tier === 'words-symsub' && s.startMs === 2000);
      expect(firstUtteranceWords.map((s) => s.text)).toEqual(['The', 'quick', 'brown', 'fox', '001']);
      expect(firstUtteranceWords.every((s) => s.endMs === 5000)).toBe(true);

      // words-pos refs words-symsub refs text: the two-level chain resolves through
      // the intermediate ref to the alignable ancestor's interval
      const firstUtterancePos = segments.filter((s) => s.tier === 'words-pos' && s.startMs === 2000);
      expect(firstUtterancePos.map((s) => s.text)).toEqual(['adj', 'adj', 'n']);
      expect(firstUtterancePos.every((s) => s.endMs === 5000)).toBe(true);
    });

    it('drops segments for broken ref chains and warns via Sentry', async () => {
      const captureMessage = vi.mocked(Sentry.captureMessage).mockClear();

      const content = await extractContent('samples/broken-refs.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      const { segments } = content;

      // Only the timed segments survive (including the resolvable ref); the broken-chain
      // segments — a dangling ref and a two-annotation reference cycle — are dropped
      expect(segments).toEqual([
        { type: 'TIME_ALIGNED_ANNOTATION', text: 'an anchored utterance', tier: 'speech', startMs: 1000, endMs: 2000 },
        { type: 'TIME_ALIGNED_ANNOTATION', text: 'a resolvable translation', tier: 'translation', startMs: 1000, endMs: 2000 },
      ]);

      expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('3 annotations dropped for unresolvable time references'), 'warning');
    });

    it('drops empty and whitespace-only annotations', async () => {
      const content = await extractContent('samples/whitespace.eaf', 'eaf');

      expect(content).toEqual({
        contentType: 'ELAN',
        segments: [{ type: 'TIME_ALIGNED_ANNOTATION', text: 'a real utterance', tier: 'speech', startMs: 1000, endMs: 2000 }],
      });
    });

    it('falls back to flat TEXT with a Sentry warning when the file is malformed', async () => {
      const captureMessage = vi.mocked(Sentry.captureMessage).mockClear();

      const content = await extractContent('samples/malformed.eaf', 'eaf');

      expect(content?.contentType).toBe('TEXT');
      expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('falling back to flat XML text'), 'warning');
    });

    it('falls back to flat TEXT with a Sentry warning when no annotation is usable', async () => {
      const captureMessage = vi.mocked(Sentry.captureMessage).mockClear();

      const content = await extractContent('samples/empty-annotations.eaf', 'eaf');

      expect(content).toEqual({ contentType: 'TEXT', text: 'urn:paragest-fixture-empty-annotations' });
      expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('produced no segments'), 'warning');
    });
  });

  describe('segment caps and truncation', () => {
    // Minimal well-formed EAF with one alignable annotation per text, in time order
    const writeSyntheticEaf = (filePath: string, texts: string[]) => {
      const slots = texts.flatMap((_, i) => [
        `<TIME_SLOT TIME_SLOT_ID="ts${2 * i + 1}" TIME_VALUE="${i * 10}"/>`,
        `<TIME_SLOT TIME_SLOT_ID="ts${2 * i + 2}" TIME_VALUE="${i * 10 + 5}"/>`,
      ]);
      const annotations = texts.map(
        (text, i) =>
          `<ANNOTATION><ALIGNABLE_ANNOTATION ANNOTATION_ID="a${i + 1}" TIME_SLOT_REF1="ts${2 * i + 1}" TIME_SLOT_REF2="ts${2 * i + 2}">` +
          `<ANNOTATION_VALUE>${text}</ANNOTATION_VALUE></ALIGNABLE_ANNOTATION></ANNOTATION>`,
      );

      fs.writeFileSync(
        filePath,
        `<?xml version="1.0" encoding="UTF-8"?><ANNOTATION_DOCUMENT><TIME_ORDER>${slots.join('')}</TIME_ORDER>` +
          `<TIER TIER_ID="speech">${annotations.join('')}</TIER></ANNOTATION_DOCUMENT>`,
      );
    };

    it('caps output at 9,500 segments, dropping the latest-in-time tail whole and warning via Sentry', async () => {
      const captureMessage = vi.mocked(Sentry.captureMessage).mockClear();
      const filePath = path.join(os.tmpdir(), 'paragest-segment-count-cap.eaf');
      writeSyntheticEaf(
        filePath,
        Array.from({ length: 9_600 }, (_, i) => `utterance ${i + 1}`),
      );

      try {
        const content = await extractContent(filePath, 'eaf');

        if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
        expect(content.segments).toHaveLength(9_500);
        expect(content.segments[0]?.text).toBe('utterance 1');
        expect(content.segments.at(-1)?.text).toBe('utterance 9500');

        expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('kept 9500 of 9600 segments'), 'warning');
        expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining(filePath), 'warning');
      } finally {
        fs.unlinkSync(filePath);
      }
    });

    it('caps summed segment text at 5MB, dropping whole segments from the tail', async () => {
      const captureMessage = vi.mocked(Sentry.captureMessage).mockClear();
      const filePath = path.join(os.tmpdir(), 'paragest-segment-size-cap.eaf');
      // Six 1MiB segments sum to 6MiB; exactly five fit the 5MiB budget
      writeSyntheticEaf(
        filePath,
        Array.from({ length: 6 }, (_, i) => `${i + 1}`.padEnd(1024 * 1024, 'x')),
      );

      try {
        const content = await extractContent(filePath, 'eaf');

        if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
        expect(content.segments.map((s) => s.text[0])).toEqual(['1', '2', '3', '4', '5']);
        expect(content.segments.every((s) => s.text.length === 1024 * 1024)).toBe(true);

        expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('kept 5 of 6 segments'), 'warning');
      } finally {
        fs.unlinkSync(filePath);
      }
    });

    it('passes a realistic dense file through untouched, with no Sentry warning', async () => {
      const captureMessage = vi.mocked(Sentry.captureMessage).mockClear();

      const content = await extractContent('samples/dense.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      expect(content.segments).toHaveLength(6_786);
      expect(captureMessage).not.toHaveBeenCalled();
    });
  });

  it('truncates extracted text to the 5MB cap at a whitespace break', async () => {
    const maxLength = 5 * 1024 * 1024;
    const line = 'the quick brown wombat jumps over the lazy dingo\n';
    const original = line.repeat(Math.ceil((maxLength + 1024) / line.length));
    const filePath = path.join(os.tmpdir(), 'paragest-truncation-test.txt');
    fs.writeFileSync(filePath, original);

    try {
      const content = await extractContent(filePath, 'txt');

      if (content?.contentType !== 'TEXT') throw new Error('Expected TEXT content');
      const { text } = content;

      expect(text.length).toBeLessThanOrEqual(maxLength);
      expect(text.length).toBeGreaterThan(maxLength - line.length);
      expect(original.startsWith(text)).toBe(true);
      // The cut excludes the whitespace break itself, so the next character in the original is that break
      expect(original[text.length]).toMatch(/[ \n]/);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('rejects extensions with no extraction strategy', async () => {
    await expect(extractContent('samples/sample.txt', 'wav')).rejects.toThrow('No extraction strategy for extension: wav');
  });
});
