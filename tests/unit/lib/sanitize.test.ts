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

describe('파일 첨부 노드 — sanitize allowlist', () => {
  it('a[data-file-attachment] 의 6개 attribute 모두 통과', () => {
    const input =
      '<p><a data-file-attachment="true" data-key="tmp/notice-attachment/abc.pdf" ' +
      'data-filename="협조공문.pdf" data-size="240000" data-mime="application/pdf" ' +
      'href="https://cdn.test/tmp/notice-attachment/abc.pdf" download="협조공문.pdf" ' +
      'target="_blank" rel="noopener noreferrer" class="notice-file-attachment">협조 공문</a></p>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('data-file-attachment="true"');
    expect(out).toContain('data-key="tmp/notice-attachment/abc.pdf"');
    expect(out).toContain('data-filename="협조공문.pdf"');
    expect(out).toContain('data-size="240000"');
    expect(out).toContain('data-mime="application/pdf"');
    expect(out).toContain('download="협조공문.pdf"');
    expect(out).toContain('class="notice-file-attachment"');
  });

  it('href javascript: 스킴 차단', () => {
    const input = '<a data-file-attachment="true" href="javascript:alert(1)">x</a>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('javascript:');
  });

  it('onclick 같은 이벤트 핸들러 차단', () => {
    const input = '<a data-file-attachment="true" onclick="alert(1)" href="#">x</a>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('onclick');
  });
});
