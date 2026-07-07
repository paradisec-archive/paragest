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
    it('extracts one ANNOTATION segment per alignable annotation, in time order, with verbatim tier IDs', async () => {
      const content = await extractContent('samples/sample.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      const { segments } = content;

      // sample.eaf has 23 ALIGNABLE_ANNOTATIONs across three time-alignable tiers
      // (ref-annotation tiers are not extracted in this slice)
      expect(segments).toHaveLength(23);
      expect(new Set(segments.map((s) => s.tier))).toEqual(new Set(['Person1 (Utterance)', 'marker', 'Person1 (Chunk)']));
      expect(segments.every((s) => s.type === 'ANNOTATION')).toBe(true);

      expect(segments[0]).toEqual({ type: 'ANNOTATION', text: 'convo start', tier: 'marker', startMs: 830, endMs: 5200 });
      expect(segments[1]).toEqual({ type: 'ANNOTATION', text: 'How do you read this?', tier: 'Person1 (Utterance)', startMs: 1040, endMs: 2330 });
      expect(segments[2]).toEqual({ type: 'ANNOTATION', text: 'How do you read this?', tier: 'Person1 (Chunk)', startMs: 1040, endMs: 2330 });

      const starts = segments.map((s) => s.startMs);
      expect(starts).toEqual([...starts].sort((a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY)));
    });

    it('widens unanchored time slots to the nearest anchored slots in TIME_ORDER', async () => {
      const content = await extractContent('samples/dense.eaf', 'eaf');

      if (content?.contentType !== 'ELAN') throw new Error('Expected ELAN content');
      const { segments } = content;

      // "quick" (a411) spans ts39→ts40, both unanchored: the start widens backwards
      // to ts38 (8000) and the end widens forwards to ts43 (8000)
      expect(segments).toContainEqual({ type: 'ANNOTATION', text: 'quick', tier: 'words-timesub', startMs: 8000, endMs: 8000 });

      // Every alignable annotation in the fixture resolves to a concrete interval
      expect(segments.every((s) => s.startMs !== undefined && s.endMs !== undefined && s.endMs >= s.startMs)).toBe(true);
    });

    it('drops empty and whitespace-only annotations', async () => {
      const content = await extractContent('samples/whitespace.eaf', 'eaf');

      expect(content).toEqual({
        contentType: 'ELAN',
        segments: [{ type: 'ANNOTATION', text: 'a real utterance', tier: 'speech', startMs: 1000, endMs: 2000 }],
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
