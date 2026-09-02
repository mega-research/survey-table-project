import { describe, expect, it } from 'vitest';

import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';

/**
 * 자유기재 사이드카 텍스트 변수의 라벨은 옵션 라벨 그대로다 — " (텍스트)" 접미사를 붙이지
 * 않는다 (2026-09-02 운영 요청: 엑셀 머리글에 그대로 노출되어 소음).
 */
function textOption(label: string) {
  return { id: 'o3', value: 'v3', label, allowTextInput: true, optionCode: '3' };
}

describe('option-text 사이드카 변수 라벨', () => {
  it('radio: 옵션 라벨 그대로, 접미사 없음', () => {
    const q = {
      id: 'q1',
      type: 'radio',
      title: '해외투자액',
      order: 0,
      questionCode: 'A19',
      options: [{ id: 'o1', value: 'v1', label: '필요함' }, textOption('의견 (자유기재)')],
    } as unknown as Question;
    const col = generateSPSSColumns([q]).find((c) => c.type === 'option-text');
    expect(col?.optionLabel).toBe('의견 (자유기재)');
  });

  it('checkbox: 옵션 라벨 그대로, 접미사 없음', () => {
    const q = {
      id: 'q2',
      type: 'checkbox',
      title: '복수 선택',
      order: 1,
      questionCode: 'A20',
      options: [{ id: 'o1', value: 'v1', label: '보기 1' }, textOption('의견 (자유기재)')],
    } as unknown as Question;
    const col = generateSPSSColumns([q]).find((c) => c.type === 'option-text');
    expect(col?.optionLabel).toBe('의견 (자유기재)');
  });
});
