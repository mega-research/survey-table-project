import { describe, expect, it } from 'vitest';

import { preserveLeadingIndent } from '@/lib/tiptap/leading-indent';

describe('preserveLeadingIndent', () => {
  it('문단 시작의 일반 스페이스를 &nbsp; 로 치환한다', () => {
    expect(preserveLeadingIndent('<p> 본 조사는</p>')).toBe('<p>&nbsp;본 조사는</p>');
  });

  it('여는 인라인 태그를 사이에 둔 들여쓰기도 치환한다', () => {
    expect(
      preserveLeadingIndent('<p style="text-align: left;"><span><strong> 귀사의</strong></span></p>'),
    ).toBe('<p style="text-align: left;"><span><strong>&nbsp;귀사의</strong></span></p>');
  });

  it('br 뒤 줄 시작 스페이스를 치환한다', () => {
    expect(preserveLeadingIndent('<p>첫 줄<br> 둘째 줄</p>')).toBe(
      '<p>첫 줄<br>&nbsp;둘째 줄</p>',
    );
  });

  it('br 연쇄 뒤와 태그 사이 스페이스도 치환한다', () => {
    expect(preserveLeadingIndent('<p>약속드립니다.<br><br> <span>설문에</span></p>')).toBe(
      '<p>약속드립니다.<br><br>&nbsp;<span>설문에</span></p>',
    );
  });

  it('스페이스 여러 개는 개수만큼 &nbsp; 로', () => {
    expect(preserveLeadingIndent('<p>   들여쓰기</p>')).toBe('<p>&nbsp;&nbsp;&nbsp;들여쓰기</p>');
  });

  it('기존 &nbsp; 와 섞인 런은 스페이스만 치환하고 유지한다', () => {
    expect(preserveLeadingIndent('<p>&nbsp; 텍스트</p>')).toBe('<p>&nbsp;&nbsp;텍스트</p>');
  });

  it('문단 중간의 단어 사이 스페이스는 건드리지 않는다', () => {
    const html = '<p>설문에 참여해주시는 모든 분들께</p>';
    expect(preserveLeadingIndent(html)).toBe(html);
  });

  it('img 뒤 스페이스는 줄 중간 공백이므로 유지한다', () => {
    const html = '<p><img src="/a.png"> 캡션</p>';
    expect(preserveLeadingIndent(html)).toBe(html);
  });

  it('이미 &nbsp; 로 시작하는 문단은 변경 없음', () => {
    const html = '<p><span>&nbsp;설문 과정에서</span></p>';
    expect(preserveLeadingIndent(html)).toBe(html);
  });
});
