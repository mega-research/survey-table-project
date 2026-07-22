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

describe('MailWrapper test footer', () => {
  it('template 종류는 비활성 미리보기 링크 안내를 표시한다', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml: '<p>본문</p>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
        testFooterKind: 'template',
      }),
    );

    expect(html).toContain('템플릿 테스트 발송');
    expect(html).toContain('미리보기용으로 비활성화');
    expect(html).not.toContain('테스트 캠페인 메일');
  });

  it('campaign 종류는 테스트 응답 기록 안내를 표시한다', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml: '<p>본문</p>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
        testFooterKind: 'campaign',
      }),
    );

    expect(html).toContain('테스트 캠페인 메일');
    expect(html).toContain('테스트 응답으로 기록');
    expect(html).not.toContain('미리보기용으로 비활성화');
  });

  it('null은 unsubscribe 다음에 테스트 푸터를 추가하지 않는다', async () => {
    const html = await render(
      createElement(MailWrapper, {
        bodyHtml: '<p>본문</p>',
        unsubscribeUrl: 'https://example.test/unsubscribe',
        testFooterKind: null,
      }),
    );

    expect(html).toContain('[unsubscribe]');
    expect(html).not.toContain('템플릿 테스트 발송');
    expect(html).not.toContain('테스트 캠페인 메일');
  });
});
