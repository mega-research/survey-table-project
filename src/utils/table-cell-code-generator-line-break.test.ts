import { describe, expect, it } from 'vitest';

import { flattenLabelLineBreaks, generateExportLabel } from './table-cell-code-generator';

describe('헤더 라벨 줄바꿈 — 내보내기 라벨에는 싣지 않는다', () => {
  it('줄바꿈과 주변 공백을 공백 하나로 편다', () => {
    expect(flattenLabelLineBreaks('매우\n만족')).toBe('매우 만족');
    expect(flattenLabelLineBreaks('매우 \n 만족\n')).toBe('매우 만족');
    expect(flattenLabelLineBreaks('보통')).toBe('보통');
  });

  it('자동 생성 엑셀 라벨의 열 라벨은 한 줄이다', () => {
    expect(generateExportLabel('C1', '매우\n만족', '회의실')).toBe('C1_매우 만족_회의실');
  });
});
