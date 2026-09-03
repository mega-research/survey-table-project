/**
 * 옵션 라벨 줄바꿈은 표시 전용 — 통계 납품물(.sav value label)에서는
 * 공백 한 칸으로 정규화되어 단일 행 라벨을 유지한다. (CONTEXT.md "옵션 라벨 줄바꿈")
 */
import { describe, expect, it } from 'vitest';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { buildValueLabels } from '@/lib/spss/sav-builder';
import type { Question } from '@/types/survey';

function radioQuestion(optionLabel: string): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    options: [{ id: 'o1', label: optionLabel, value: '1' }],
  } as Question;
}

const singleCol = { type: 'single', spssVarName: 'Q1' } as SPSSExportColumn;

describe('SPSS value label 줄바꿈 정규화', () => {
  it('옵션 라벨의 줄바꿈은 공백 한 칸으로 정규화된다', () => {
    const labels = buildValueLabels(
      singleCol,
      radioQuestion('SW계열1\n(전산ㆍ컴퓨터, 응용소프트웨어 등)'),
    );
    expect(labels?.[0]?.label).toBe('SW계열1 (전산ㆍ컴퓨터, 응용소프트웨어 등)');
  });

  it('줄바꿈 앞뒤 공백과 연속 줄바꿈도 공백 한 칸으로 붕괴된다', () => {
    const labels = buildValueLabels(singleCol, radioQuestion('A \n\n B'));
    expect(labels?.[0]?.label).toBe('A B');
  });
});
