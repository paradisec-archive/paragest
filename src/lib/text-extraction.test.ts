import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractContent } from './text-extraction.js';

describe('extractContent', () => {
  it('wraps plain text files as TEXT content', async () => {
    const content = await extractContent('samples/sample.txt', 'txt');

    expect(content).toEqual({ contentType: 'TEXT', text: 'MOO\nalkigaslgjas\n' });
  });

  it('returns null when a file yields no text at all', async () => {
    const content = await extractContent('samples/empty.txt', 'txt');

    expect(content).toBeNull();
  });

  it('extracts text from PDF files', async () => {
    const content = await extractContent('samples/sample.pdf', 'pdf');

    expect(content).toEqual({ contentType: 'TEXT', text: 'Test\n\n-- 1 of 1 --\n\n' });
  });

  it('extracts EAF files as flat XML text', async () => {
    const content = await extractContent('samples/sample.eaf', 'eaf');

    expect(content).toEqual({
      contentType: 'TEXT',
      text: 'urn:nl-mpi-tools-elan-eaf:80ffa83c-9429-47f8-aaff-5defd3569d9d 57 How do you read this? このリンゴ、おいしいね！ What does it mean? It means "This apple is delicious". "この" means this "リンゴ" means "apple" and "おいしい" means delicious. Oh thanks convo start convo body convo end How do you read this? このリンゴ、おいしいね！ What does it mean? It means "This apple is delicious". この means "this" リンゴ means "apple" and おいしい means "delicious" oh thanks en jp en en jp en jp en en jp en en en jp en en en en en en en jp',
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
