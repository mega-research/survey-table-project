import { describe, expect, it } from 'vitest';

import { formatExcelDateTime, buildCodebookValueLabel, buildStepLabelMap } from '@/lib/analytics/raw-export-helpers';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';

describe('formatExcelDateTime', () => {
  it('KST YYYY-MM-DD HH:mm 으로 포맷한다', () => {
    // 2026-06-03T05:30:00Z = KST 14:30
    expect(formatExcelDateTime(new Date('2026-06-03T05:30:00Z'))).toBe('2026-06-03 14:30');
  });
  it('null 은 빈 문자열', () => {
    expect(formatExcelDateTime(null)).toBe('');
  });
});

describe('buildCodebookValueLabel', () => {
  const radioQ = {
    id: 'q1', type: 'radio', title: 'Q1', questionCode: 'Q1',
    options: [
      { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
      { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
    ],
  } as unknown as Question;
  const qMap = new Map<string, Question>([['q1', radioQ]]);

  it('단일선택은 code=label 나열', () => {
    const col = { type: 'single', questionId: 'q1', spssVarName: 'Q1' } as SPSSExportColumn;
    expect(buildCodebookValueLabel(col, qMap)).toBe('1=남성, 2=여성');
  });

  it('checkbox 항목은 빈값=비선택, code=선택', () => {
    const col = {
      type: 'checkbox-item', questionId: 'q1', spssVarName: 'Q1_1',
      optionIndex: 0,
    } as SPSSExportColumn;
    const cbQ = {
      id: 'q1', type: 'checkbox', title: 'Q1', questionCode: 'Q1',
      options: [{ id: 'a', label: 'AI', value: 'opt1', spssNumericCode: 1 }],
    } as unknown as Question;
    expect(buildCodebookValueLabel(col, new Map([['q1', cbQ]]))).toBe('빈값=비선택, 1=선택');
  });

  it('텍스트는 빈 문자열', () => {
    const col = { type: 'text', questionId: 'q1', spssVarName: 'Q1' } as SPSSExportColumn;
    expect(buildCodebookValueLabel(col, qMap)).toBe('');
  });
});

describe('테이블 checkbox 셀 코딩북 값 라벨 - spssNumericCode 반영', () => {
  it('checkboxOptions의 spssNumericCode가 코딩북에 그대로 쓰인다', () => {
    const question = {
      id: 'tq1',
      type: 'table',
      title: '테이블 질문',
      required: false,
      order: 1,
      questionCode: 'T1',
      tableColumns: [{ id: 'c1', label: '열1' }],
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            {
              id: 'cell1',
              content: '',
              type: 'checkbox',
              cellCode: 'T1_r1_c1',
              checkboxOptions: [
                { id: 'o1', label: '보기A', value: 'o1', spssNumericCode: 7 },
              ],
            },
          ],
        },
      ],
    } as unknown as Question;

    const columns = generateSPSSColumns([question]);
    const checkboxCol = columns.find(
      (c) => c.tableCellType === 'checkbox' && c.optionIndex === 0,
    );
    expect(checkboxCol).toBeDefined();

    const questionMap = new Map([[question.id, question]]);
    // 수정 전 버그: cellOptions 미세팅이라 optionIndex+1=1로 오기재된다
    expect(buildCodebookValueLabel(checkboxCol!, questionMap)).toBe('빈값=비선택, 7=선택');
  });
});

describe('buildStepLabelMap', () => {
  const groups = [
    { id: 'g1', order: 1, name: '섹션A' },
    { id: 'g2', order: 2, name: '섹션B' },
  ];
  const questions = [
    { id: 'q1', order: 1, title: 'Q1. 성별', type: 'radio', groupId: 'g1', questionCode: 'Q13' },
    { id: 'q2', order: 2, title: '거주 지역', type: 'radio', groupId: 'g2', pageBreakBefore: true, questionCode: 'Q14' },
  ];

  it('대표 질문의 질문코드를 라벨로 쓴다 — 제목 Qx 표기보다 우선', () => {
    const labels = [...buildStepLabelMap(questions, groups).values()];
    expect(labels).toContain('Q13');
    expect(labels).toContain('Q14');
  });

  it('질문코드가 없으면 제목 Qx 파싱, 둘 다 없으면 공백 — 위치 표기는 쓰지 않는다', () => {
    const noCode = [
      { id: 'q1', order: 1, title: 'Q1. 성별', type: 'radio', groupId: 'g1', questionCode: null },
      { id: 'q2', order: 2, title: '거주 지역', type: 'radio', groupId: 'g2', pageBreakBefore: true, questionCode: null },
    ];
    const labels = [...buildStepLabelMap(noCode, groups).values()];
    expect(labels).toContain('Q1');
    expect(labels).toContain('');
    expect(labels.some((l) => l.includes('번째'))).toBe(false);
  });

  it('질문이 없으면 빈 맵', () => {
    expect(buildStepLabelMap([], []).size).toBe(0);
  });
});
