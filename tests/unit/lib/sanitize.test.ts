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

describe('CSS 인젝션 차단 — RICH_CONFIG allowedStyles', () => {
  it('position:fixed 제거', () => {
    const input = '<p style="position:fixed;top:0;left:0">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('position');
    expect(out).not.toContain('fixed');
  });

  it('position:absolute 제거', () => {
    const input = '<p style="position:absolute">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('position');
    expect(out).not.toContain('absolute');
  });

  it('background:url(http://evil) 제거', () => {
    const input = '<p style="background:url(http://evil.test/x.png)">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('url(');
    expect(out).not.toContain('evil');
  });

  it('background-image:url(...) 제거', () => {
    const input = '<p style="background-image:url(http://evil.test/x.png)">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('url(');
    expect(out).not.toContain('evil');
  });

  it('expression(...) 제거', () => {
    const input = '<p style="width:expression(alert(1))">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('expression');
  });

  it('behavior 제거', () => {
    const input = '<p style="behavior:url(#default#time2)">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('behavior');
  });

  it('-moz-binding 제거', () => {
    const input = '<p style="-moz-binding:url(http://evil.test/xbl.xml#x)">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).not.toContain('binding');
    expect(out).not.toContain('evil');
  });
});

describe('CSS 인젝션 차단 — 안전 속성 보존', () => {
  it('text-align:center 보존 (TipTap 정렬)', () => {
    const input = '<p style="text-align:center">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('text-align');
    expect(out).toContain('center');
  });

  it('color:#hex 보존 (TipTap 색상)', () => {
    const input = '<span style="color:#ff0000">x</span>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('color');
    expect(out).toContain('#ff0000');
  });

  it('background-color:#hex 보존', () => {
    const input = '<span style="background-color:#fef08a">x</span>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('background-color');
    expect(out).toContain('#fef08a');
  });

  it('color rgb() 보존', () => {
    const input = '<span style="color:rgb(255, 0, 0)">x</span>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('color');
    expect(out).toContain('rgb(255, 0, 0)');
  });

  it('font-size / font-weight / font-style / text-decoration 보존', () => {
    const input =
      '<span style="font-size:16px;font-weight:700;font-style:italic;text-decoration:underline">x</span>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('font-size');
    expect(out).toContain('16px');
    expect(out).toContain('font-weight');
    expect(out).toContain('700');
    expect(out).toContain('font-style');
    expect(out).toContain('italic');
    expect(out).toContain('text-decoration');
    expect(out).toContain('underline');
  });

  it('padding / margin / width 보존', () => {
    const input = '<td style="padding:8px;margin:4px;width:120px">x</td>';
    const out = sanitizeRichHtml(`<table><tr>${input}</tr></table>`);
    expect(out).toContain('padding');
    expect(out).toContain('margin');
    expect(out).toContain('width');
  });
});

describe('CSS 인젝션 차단 — 우회 시도', () => {
  it('대소문자 우회 (POSITION:FIXED) 차단', () => {
    const input = '<p style="POSITION:FIXED">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out.toLowerCase()).not.toContain('position');
    expect(out.toLowerCase()).not.toContain('fixed');
  });

  it('여분 공백 우회 (position :  fixed) 차단', () => {
    const input = '<p style="position  :   fixed">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out.toLowerCase()).not.toContain('position');
    expect(out.toLowerCase()).not.toContain('fixed');
  });

  it('!important 가 붙은 위험 속성 차단', () => {
    const input = '<p style="position:fixed !important">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out.toLowerCase()).not.toContain('position');
  });

  it('CSS 주석 우회 차단', () => {
    const input = '<p style="width:expr/**/ession(alert(1))">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out.toLowerCase()).not.toContain('expression');
  });

  it('url 대소문자 우회 (URL(...)) 차단', () => {
    const input = '<p style="background:URL(http://evil.test/x.png)">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out.toLowerCase()).not.toContain('url(');
    expect(out.toLowerCase()).not.toContain('evil');
  });

  it('위험 속성만 제거하고 같은 style 내 안전 속성은 보존', () => {
    const input = '<p style="text-align:center;position:fixed">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out).toContain('text-align');
    expect(out).toContain('center');
    expect(out.toLowerCase()).not.toContain('position');
    expect(out.toLowerCase()).not.toContain('fixed');
  });

  it('사용자 입력 background:url(http) 는 차단되지만 data:image/svg+xml 패턴은 아님', () => {
    const input = '<p style="background:url(http://evil.test/x.png)">x</p>';
    const out = sanitizeRichHtml(input);
    expect(out.toLowerCase()).not.toContain('http://evil');
  });
});

describe('CSS 인젝션 차단 — transformTags 주입 장식 스타일 보존(회귀 방지)', () => {
  it('표 border-collapse / border 가 보존됨', () => {
    const out = sanitizeRichHtml('<table><tbody><tr><td>a</td></tr></tbody></table>');
    expect(out).toContain('border-collapse');
    expect(out).toContain('border:1px solid #d1d5db');
  });

  it('메일 첨부 박스의 paperclip data:image/svg+xml 배경이 보존됨', () => {
    const out = sanitizeRichHtml(
      '<a data-file-attachment="true" href="https://cdn.test/x.pdf">file</a>',
    );
    expect(out).toContain('data:image/svg+xml');
    expect(out).toContain('display:inline-block');
    expect(out).toContain('border-radius');
  });

  it('첨부 라벨 span 의 display:block 이 보존됨', () => {
    const out = sanitizeRichHtml(
      '<span class="notice-file-attachment-label">label</span>',
    );
    expect(out).toContain('display:block');
  });
});

describe('CSS 인젝션 차단 — TipTap 직렬화 스타일 보존(회귀 방지)', () => {
  it('표 가운데 정렬 margin:0 auto 보존', () => {
    const out = sanitizeRichHtml(
      '<table style="margin: 0 auto"><tbody><tr><td>a</td></tr></tbody></table>',
    );
    expect(out).toContain('margin:0 auto');
  });

  it('표 오른쪽 정렬 margin:0 0 0 auto 보존', () => {
    const out = sanitizeRichHtml(
      '<table style="margin: 0 0 0 auto"><tbody><tr><td>a</td></tr></tbody></table>',
    );
    expect(out).toContain('margin:0 0 0 auto');
  });

  it('이미지 wrapper 스타일 box-sizing / max-width 보존', () => {
    const out = sanitizeRichHtml(
      '<img src="https://x.test/a.png" style="display: inline-block; vertical-align: top; box-sizing: border-box; width: 50%; height: auto; max-width: 100%;" alt="a">',
    );
    expect(out).toContain('box-sizing:border-box');
    expect(out).toContain('max-width:100%');
    expect(out).toContain('width:50%');
  });

  it('셀 세로정렬 vertical-align / 배경색 보존', () => {
    const out = sanitizeRichHtml(
      '<table><tbody><tr><td style="vertical-align: middle; background-color: #ff0000">a</td></tr></tbody></table>',
    );
    expect(out).toContain('vertical-align:middle');
    expect(out).toContain('background-color:#ff0000');
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

describe('sanitizeRichHtml - 이미지맵 (클릭 영역)', () => {
  it('map/area/usemap 을 보존한다', () => {
    const html =
      '<img src="https://r2.example.com/mail/a.png" width="320" usemap="#m-link-0">' +
      '<map name="m-link-0"><area shape="rect" coords="32,122,192,147" ' +
      'href="https://survey.example.com/i/abc" target="_blank" rel="noopener noreferrer" ' +
      'alt="설문 참여 링크"></map>';
    const out = sanitizeRichHtml(html);
    expect(out).toContain('usemap="#m-link-0"');
    expect(out).toContain('<map name="m-link-0">');
    expect(out).toContain('coords="32,122,192,147"');
    expect(out).toContain('href="https://survey.example.com/i/abc"');
  });

  it('img 의 data-link-* 속성은 스트립한다', () => {
    const html =
      '<img src="https://r2.example.com/mail/a.png" width="320" ' +
      'data-link-rect="0.1,0.5,0.5,0.1" data-link-natural="1700,1300" ' +
      'data-link-coords="32,122,192,147">';
    const out = sanitizeRichHtml(html);
    expect(out).not.toContain('data-link-rect');
    expect(out).not.toContain('data-link-natural');
    expect(out).not.toContain('data-link-coords');
    expect(out).toContain('src=');
  });

  it('area 의 javascript: href 는 제거한다', () => {
    const html =
      '<map name="m"><area shape="rect" coords="0,0,10,10" href="javascript:alert(1)"></map>';
    const out = sanitizeRichHtml(html);
    expect(out).not.toContain('javascript:');
  });
});

describe('sanitizeRichHtml - 클릭 영역 밴드 테이블', () => {
  const bandTable =
    '<table class="mail-link-bands" style="width: 100%; max-width: 100%; border-collapse: collapse;">' +
    '<tbody>' +
    '<tr><td class="mail-link-bands" style="padding: 0;">' +
    '<img src="https://r2.example.com/mail/link-bands/h-top.png" alt="" style="display: block; width: 100%; height: auto;">' +
    '</td></tr>' +
    '<tr><td class="mail-link-bands" style="padding: 0;">' +
    '<a href="https://survey.example.com/i/abc" target="_blank" rel="noopener noreferrer">' +
    '<img src="https://r2.example.com/mail/link-bands/h-mid.png" alt="설문 참여 링크" style="display: block; width: 100%; height: auto;">' +
    '</a></td></tr>' +
    '</tbody></table>';

  it('밴드 테이블/셀에는 기본 표 테두리 스타일을 주입하지 않는다', () => {
    const out = sanitizeRichHtml(bandTable);
    expect(out).not.toContain('border:1px solid');
    expect(out).toContain('mail-link-bands');
    expect(out).toContain('href="https://survey.example.com/i/abc"');
    expect(out).toContain('display:block');
  });

  it('일반 테이블은 기존처럼 테두리 스타일이 주입된다', () => {
    const out = sanitizeRichHtml('<table><tbody><tr><td>x</td></tr></tbody></table>');
    expect(out).toContain('border:1px solid');
  });

  it('img 의 data-link-bands 속성은 스트립한다', () => {
    const out = sanitizeRichHtml(
      '<img src="https://r2.example.com/mail/a.png" data-link-bands="a|b|c">',
    );
    expect(out).not.toContain('data-link-bands');
  });
});
