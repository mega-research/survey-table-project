import { describe, expect, it } from 'vitest';

import { renderMailPreview, type PreviewSample } from '@/lib/mail/render-preview';

const sample: PreviewSample = {
  attrs: { 수행기관: 'KOTRA', 빈값: '' },
  email: 'ljwoon94@gmail.com',
  inviteUrl: 'https://example.com/survey/abc?invite=tok-1',
};

describe('renderMailPreview - invite_link auto anchor', () => {
  it('plain text {{invite_link}} 토큰은 a 태그로 자동 변환 (send 모드)', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: '<p>아래 링크: {{invite_link}}</p>',
      fromName: 'sender',
      sample,
      mode: 'send',
    });
    expect(out.bodyHtml).toContain('<a href="https://example.com/survey/abc?invite=tok-1"');
    expect(out.bodyHtml).toContain('>https://example.com/survey/abc?invite=tok-1</a>');
  });

  it('plain text {{invite_link}} 는 preview 모드에서도 a 태그로 변환', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: '<p>링크: {{invite_link}}</p>',
      fromName: 'sender',
      sample,
      mode: 'preview',
    });
    expect(out.bodyHtml).toMatch(/<a [^>]*href="https:\/\/example\.com\/survey\/abc\?invite=tok-1"/);
  });

  it('이미 a 태그로 감싸진 {{invite_link}} 는 nested anchor 만들지 않음 (변수 메뉴 케이스)', () => {
    const html = '<p><a href="{{invite_link}}">{{invite_link}}</a></p>';
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: html,
      fromName: 'sender',
      sample,
      mode: 'send',
    });
    // anchor 두 개(여는 + 닫는)만 — nested 면 4개가 됨
    const openCount = (out.bodyHtml.match(/<a\b/g) ?? []).length;
    const closeCount = (out.bodyHtml.match(/<\/a>/g) ?? []).length;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
    expect(out.bodyHtml).toContain('href="https://example.com/survey/abc?invite=tok-1"');
    expect(out.bodyHtml).toContain('>https://example.com/survey/abc?invite=tok-1</a>');
  });

  it('attrs 토큰은 자동 anchor 변환하지 않음 (invite_link 만 특별 처리)', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: '<p>{{수행기관}}</p>',
      fromName: 'sender',
      sample,
      mode: 'send',
    });
    expect(out.bodyHtml).toBe('<p>KOTRA</p>');
  });

  it('missing invite_link 는 send 모드에서 빈 문자열로 치환 — anchor 만들지 않음', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: '<p>{{invite_link}}</p>',
      fromName: 'sender',
      sample: { attrs: {}, email: null, inviteUrl: null },
      mode: 'send',
    });
    expect(out.bodyHtml).toBe('<p></p>');
  });

  it('preview 모드의 missing invite_link 는 missing span 유지', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: '<p>{{invite_link}}</p>',
      fromName: 'sender',
      sample: { attrs: {}, email: null, inviteUrl: null },
      mode: 'preview',
    });
    expect(out.bodyHtml).toContain('mail-preview-missing');
    expect(out.bodyHtml).not.toContain('<a ');
  });

  it('subject/fromName 의 invite_link 는 plain text 치환 (anchor 변환 안 함)', () => {
    const out = renderMailPreview({
      subject: '[테스트] {{invite_link}}',
      bodyHtml: '<p>본문</p>',
      fromName: '{{invite_link}}',
      sample,
      mode: 'send',
    });
    expect(out.subject).toBe('[테스트] https://example.com/survey/abc?invite=tok-1');
    expect(out.fromName).toBe('https://example.com/survey/abc?invite=tok-1');
  });
});

describe('renderMailPreview - 이미지 클릭 영역', () => {
  const bodyWithLinkArea =
    '<p><img src="https://r2.example.com/mail/a.png" style="width: 100%; height: auto;" ' +
    'data-link-rect="0.1,0.5,0.5,0.1" ' +
    'data-link-bands="https://r2.example.com/mail/link-bands/h-top.png|' +
    'https://r2.example.com/mail/link-bands/h-mid.png|' +
    'https://r2.example.com/mail/link-bands/h-bottom.png"></p>';

  it('send 모드에서 가운데 밴드 링크가 실제 초대 URL 로 치환된다', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: bodyWithLinkArea,
      fromName: '발신자',
      sample: { attrs: {}, email: null, inviteUrl: 'https://survey.example.com/i/abc' },
      mode: 'send',
    });
    expect(out.bodyHtml).toContain('<table class="mail-link-bands"');
    expect(out.bodyHtml).toContain('href="https://survey.example.com/i/abc"');
    expect(out.bodyHtml).toContain('link-bands/h-mid.png');
    expect(out.bodyHtml).not.toContain('{{invite_link}}');
  });

  it('preview 모드에서도 밴드 테이블이 생성되고 href 가 치환된다', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: bodyWithLinkArea,
      fromName: '발신자',
      sample: { attrs: {}, email: null, inviteUrl: 'https://survey.example.com/i/abc' },
      mode: 'preview',
    });
    expect(out.bodyHtml).toContain('<table class="mail-link-bands"');
    expect(out.bodyHtml).toContain('href="https://survey.example.com/i/abc"');
  });

  it('send 모드에서 sample 이 없으면 밴드 링크 href 는 빈 값으로 치환된다', () => {
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: bodyWithLinkArea,
      fromName: '발신자',
      sample: null,
      mode: 'send',
    });
    expect(out.bodyHtml).toContain('href=""');
    expect(out.bodyHtml).not.toContain('{{invite_link}}');
  });

  it('밴드 미생성(미저장) 클릭 영역 이미지는 원본 그대로 유지된다', () => {
    const unsaved =
      '<p><img src="https://r2.example.com/mail/a.png" data-link-rect="0.1,0.5,0.5,0.1"></p>';
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: unsaved,
      fromName: '발신자',
      sample: null,
      mode: 'send',
    });
    expect(out.bodyHtml).toBe(unsaved);
  });

  it('클릭 영역 없는 본문은 기존과 동일하다', () => {
    const plain = '<p><img src="https://r2.example.com/mail/a.png" width="320"></p>';
    const out = renderMailPreview({
      subject: '제목',
      bodyHtml: plain,
      fromName: '발신자',
      sample: null,
      mode: 'send',
    });
    expect(out.bodyHtml).toBe(plain);
  });
});
