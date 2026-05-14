import { createElement } from 'react';

import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import { MailWrapper } from '@/lib/mail/template-wrapper';

describe('MailWrapper sanitizes bodyHtml before mail delivery', () => {
  it('strips script tags from bodyHtml', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml: '<p>안녕하세요</p><script>alert("xss")</script>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
      }),
    );

    expect(html).toContain('안녕하세요');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
  });

  it('strips iframe tags from bodyHtml', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml: '<p>본문</p><iframe src="https://evil.test"></iframe>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
      }),
    );

    expect(html).toContain('본문');
    expect(html).not.toContain('<iframe');
  });

  it('strips inline event handlers from anchor tags', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml: '<a href="https://x.test" onclick="alert(1)">링크</a>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
      }),
    );

    expect(html).toContain('href="https://x.test"');
    expect(html).not.toContain('onclick');
  });

  it('preserves safe rich-text tags (strong, a, img)', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml:
          '<p><strong>중요</strong> <a href="https://x.test">링크</a> <img src="https://x.test/img.png" alt="img" /></p>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
      }),
    );

    expect(html).toContain('<strong');
    expect(html).toContain('href="https://x.test"');
    expect(html).toContain('<img');
  });
});
