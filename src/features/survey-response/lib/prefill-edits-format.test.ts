import { describe, expect, it } from 'vitest';

import { computePrefillEdits } from '@/lib/survey/prefill-edits';
import type { Question } from '@/types/survey';

import { normalizeFormatValues } from './format-normalize';

/**
 * 고친 프리필 판정 × 제출 정돈 — 응답 화면은 제출 직전 형식 칸 값을 정돈한다(`normalizeFormatValues`,
 * `0212345678` → `02-1234-5678`). 서버 판정이 정돈 전 명단 글자와 그대로 비교하면 손대지 않은 번호도
 * 「고쳤다」가 된다(2026-11-05 리뷰). 실제 정돈 경로를 지난 값으로 판정한다.
 */
const table = (inputType: string, template = '{{전화번호}}'): Question =>
  ({
    id: 'q',
    type: 'table',
    title: '표',
    order: 0,
    required: false,
    tableColumns: [{ id: 'c', label: '전화' }],
    tableRowsData: [
      {
        id: 'r',
        label: '전화',
        cells: [{ id: 'cell', type: 'input', content: '', inputType, defaultValueTemplate: template, prefillEditable: true, exportPrefillEdit: true }],
      },
    ],
  }) as unknown as Question;

function submitted(q: Question, attrs: Record<string, string>, typed: string) {
  return normalizeFormatValues([q], { q: { cell: typed } }, attrs);
}

describe('고친 프리필 판정 — 제출 정돈을 지난 값', () => {
  it.each([
    ['phone', '0212345678', '0212345678'],
    ['phone', '02-1234-5678', '0212345678'],
    ['mobile', '01012345678', '010 1234 5678'],
    ['biz_number', '1234567890', '123-45-67890'],
    ['date', '2015.3.1', '2015-03-01'],
    ['date', '20150301', '20150301'],
    ['number', '1,000', '1000'],
  ])('%s 칸에서 명단 %s 를 손대지 않거나 같은 값으로 적으면 고친 것이 아니다', (inputType, roster, typed) => {
    const q = table(inputType);
    const attrs = { 전화번호: roster };
    expect(computePrefillEdits([q], submitted(q, attrs, typed), attrs)).toEqual({});
  });

  it('실제로 다른 번호를 적으면 고친 것이다', () => {
    const q = table('phone');
    const attrs = { 전화번호: '0212345678' };
    expect(computePrefillEdits([q], submitted(q, attrs, '02-9999-8888'), attrs)).toEqual({ q: ['cell'] });
  });

  it('형식 없는 칸은 글자 그대로 비교한다(앞뒤 공백만 무시)', () => {
    const q = table('text');
    const attrs = { 전화번호: '02-123-4567 (내선 12)' };
    expect(computePrefillEdits([q], submitted(q, attrs, ' 02-123-4567 (내선 12) '), attrs)).toEqual({});
    expect(computePrefillEdits([q], submitted(q, attrs, '02-123-4567'), attrs)).toEqual({ q: ['cell'] });
  });
});
