import { describe, expect, it } from 'vitest';

import { stripTrailingEmptyParagraph } from '@/lib/tiptap/trailing-node';

describe('stripTrailingEmptyParagraph', () => {
  it('문서 끝의 속성 없는 빈 문단을 제거한다', () => {
    expect(stripTrailingEmptyParagraph('<table><tbody></tbody></table><p></p>')).toBe(
      '<table><tbody></tbody></table>',
    );
  });

  it('TextAlign 이 붙인 style 속성이 있어도 끝의 빈 문단을 제거한다', () => {
    expect(
      stripTrailingEmptyParagraph(
        '<table><tbody></tbody></table><p style="text-align: left"></p>',
      ),
    ).toBe('<table><tbody></tbody></table>');
    expect(
      stripTrailingEmptyParagraph('<img src="a.png"><p style="text-align: left;"></p>'),
    ).toBe('<img src="a.png">');
  });

  it('연속된 끝의 빈 문단을 모두 제거한다', () => {
    expect(
      stripTrailingEmptyParagraph(
        '<p>내용</p><p></p><p style="text-align: center"></p>',
      ),
    ).toBe('<p>내용</p>');
  });

  it('내용이 있는 끝 문단은 유지한다', () => {
    expect(stripTrailingEmptyParagraph('<p style="text-align: left">내용</p>')).toBe(
      '<p style="text-align: left">내용</p>',
    );
  });

  it('사용자가 의도한 빈 줄(<p><br></p>)은 유지한다', () => {
    expect(stripTrailingEmptyParagraph('<p>내용</p><p><br></p>')).toBe(
      '<p>내용</p><p><br></p>',
    );
  });

  it('문서 중간의 빈 문단은 건드리지 않는다', () => {
    expect(stripTrailingEmptyParagraph('<p></p><p>내용</p>')).toBe('<p></p><p>내용</p>');
  });
});
