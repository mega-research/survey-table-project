import { describe, expect, it } from 'vitest';

import { sanitizeRichHtml } from '@/lib/sanitize';

describe('sanitizeRichHtml', () => {
  it('strips <script> tags', () => {
    const input = '<p>hi</p><script>alert(1)</script>';
    expect(sanitizeRichHtml(input)).toBe('<p>hi</p>');
  });

  it('strips inline event handlers', () => {
    const input = '<img src="x" onerror="alert(1)">';
    expect(sanitizeRichHtml(input)).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    const input = '<a href="javascript:alert(1)">x</a>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('javascript:');
  });

  it('keeps allowed formatting tags', () => {
    const input = '<p><strong>bold</strong><em>italic</em></p>';
    expect(sanitizeRichHtml(input)).toBe(input);
  });

  it('keeps img with safe attributes', () => {
    const input = '<img src="https://example.com/a.png" alt="a">';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('alt="a"');
  });

  it('keeps text-align style (TipTap output)', () => {
    const input = '<p style="text-align: center">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('text-align');
  });

  it('handles null/undefined safely', () => {
    expect(sanitizeRichHtml(null)).toBe('');
    expect(sanitizeRichHtml(undefined)).toBe('');
  });
});
