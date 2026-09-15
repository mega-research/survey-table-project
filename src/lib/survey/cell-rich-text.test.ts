import { describe, expect, it } from 'vitest';

import { sanitizeCellHtml } from '@/lib/sanitize';

import { cellHtmlHasMarks, plainTextToCellHtml } from './cell-rich-text';

describe('plainTextToCellHtml', () => {
  it('줄마다 문단 하나, 특수문자는 이스케이프한다', () => {
    expect(plainTextToCellHtml('제목 <A&B>\n설명')).toBe('<p>제목 &lt;A&amp;B&gt;</p><p>설명</p>');
  });

  it('빈 줄은 빈 문단, 빈 문자열은 빈 문자열', () => {
    expect(plainTextToCellHtml('a\n\nb')).toBe('<p>a</p><p></p><p>b</p>');
    expect(plainTextToCellHtml('')).toBe('');
  });
});

describe('cellHtmlHasMarks', () => {
  it('굵게·글자색이 있으면 true, 문단·줄바꿈뿐이면 false', () => {
    expect(cellHtmlHasMarks('<p>a <strong>b</strong></p>')).toBe(true);
    expect(cellHtmlHasMarks('<p><span style="color: #ff0000">b</span></p>')).toBe(true);
    expect(cellHtmlHasMarks('<p>a</p><p>b<br>c</p>')).toBe(false);
  });
});

describe('sanitizeCellHtml', () => {
  it('굵게·글자색·문단·줄바꿈만 남긴다', () => {
    expect(
      sanitizeCellHtml('<p>a <strong>b</strong> <span style="color: #ff0000">c</span><br>d</p>'),
    ).toBe('<p>a <strong>b</strong> <span style="color:#ff0000">c</span><br />d</p>');
  });

  it('브라우저가 다시 쓴 rgb() 색도 통과한다', () => {
    expect(sanitizeCellHtml('<p><span style="color: rgb(255, 0, 0);">c</span></p>')).toBe(
      '<p><span style="color:rgb(255, 0, 0)">c</span></p>',
    );
  });

  it('이미지·링크·스크립트·다른 스타일은 떨어진다', () => {
    expect(
      sanitizeCellHtml(
        '<p><a href="https://x">l</a><img src="x"><script>1</script><span style="font-size:30px;color:red">c</span></p>',
      ),
    ).toBe('<p>l<span>c</span></p>');
  });
});
