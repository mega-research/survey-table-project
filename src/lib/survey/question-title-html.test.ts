import { describe, expect, it } from 'vitest';

import { sanitizeTitleHtml } from '@/lib/sanitize';
import {
  resolveQuestionTitleHtml,
  titleHtmlHasMarks,
  titleHtmlToText,
} from '@/lib/survey/question-title-html';

describe('문항 제목 서식본', () => {
  it('마크 유무를 가린다', () => {
    expect(titleHtmlHasMarks('<p>평문</p>')).toBe(false);
    expect(titleHtmlHasMarks('<p><u>밑줄</u></p>')).toBe(true);
    expect(titleHtmlHasMarks('<p><span style="font-size: 20px">큰</span></p>')).toBe(true);
  });

  it('글자만 뽑는다 — 엔티티를 풀고 문단은 공백', () => {
    expect(titleHtmlToText('<p>A &amp; <strong>B</strong></p><p>C</p>')).toBe('A & B C');
  });

  it('평문 제목과 글자가 같을 때만 서식본을 쓰고, 토큰을 치환한다', () => {
    const q = { title: 'A4. {{회사}} 공급처', titleHtml: '<p>A4. <strong>{{회사}}</strong> 공급처</p>' };
    expect(resolveQuestionTitleHtml(q, { 회사: '메가' }, {})).toBe(
      '<p>A4. <strong>메가</strong> 공급처</p>',
    );
  });

  it('평문만 바뀌어 글자가 어긋나면 서식본을 버린다', () => {
    const q = { title: '새 제목', titleHtml: '<p><strong>옛 제목</strong></p>' };
    expect(resolveQuestionTitleHtml(q, {}, {})).toBeUndefined();
  });

  it('마크 없는 서식본·빈 값은 쓰지 않는다', () => {
    expect(resolveQuestionTitleHtml({ title: 'a', titleHtml: '<p>a</p>' }, {}, {})).toBeUndefined();
    expect(resolveQuestionTitleHtml({ title: 'a', titleHtml: null }, {}, {})).toBeUndefined();
  });
});

describe('sanitizeTitleHtml', () => {
  it('굵게·밑줄·색·허용된 크기는 남긴다', () => {
    const html =
      '<p><strong>a</strong><u>b</u><span style="color:#ff0000">c</span><span style="font-size:20px">d</span></p>';
    const out = sanitizeTitleHtml(html);
    expect(out).toContain('<strong>a</strong>');
    expect(out).toContain('<u>b</u>');
    expect(out).toContain('color:#ff0000');
    expect(out).toContain('font-size:20px');
  });

  it('허용 밖의 크기·태그·속성은 떨어뜨린다', () => {
    const out = sanitizeTitleHtml(
      '<p><span style="font-size:200px">x</span><img src=x onerror=alert(1)><a href="javascript:1">y</a></p>',
    );
    expect(out).not.toContain('200px');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<a');
  });
});
