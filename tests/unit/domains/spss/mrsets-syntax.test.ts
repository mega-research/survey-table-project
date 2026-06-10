import { describe, expect, it } from 'vitest';

import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { generateMrsetsSyntax } from '@/lib/spss/mrsets-syntax';
import type { Question } from '@/types/survey';

function q(overrides: Record<string, unknown>): Question {
  return {
    id: 'q1',
    title: '질문',
    required: false,
    order: 1,
    questionCode: 'Q1',
    ...overrides,
  } as unknown as Question;
}

const checkboxManual = q({
  type: 'checkbox',
  title: "이용 매체를 모두 고르세요. '복수응답'",
  options: [
    { id: 'o1', label: 'TV', value: 'o1', optionCode: '1', spssNumericCode: 1 },
    { id: 'o2', label: '라디오', value: 'o2', optionCode: '2', spssNumericCode: 2 },
  ],
});

const checkboxTableSource = q({
  id: 'q2',
  questionCode: 'Q2',
  type: 'checkbox',
  title: '보유 기기',
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cellA', content: 'UHD', type: 'choice_opt', spssNumericCode: 1 },
        { id: 'cellB', content: 'FHD', type: 'choice_opt', spssNumericCode: 2 },
      ],
    },
  ],
});

const radioQuestion = q({
  id: 'q3',
  questionCode: 'Q3',
  type: 'radio',
  options: [{ id: 'o1', label: '예', value: 'o1', spssNumericCode: 1 }],
});

describe('generateMrsetsSyntax - 질문 단위 MCGROUP', () => {
  it('manual checkbox 질문은 optionCode 변수명으로 MCGROUP을 만든다', () => {
    const questions = [checkboxManual];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    expect(syntax).toContain('MRSETS');
    expect(syntax).toContain('/MCGROUP NAME=$Q1');
    expect(syntax).toContain('VARIABLES=Q1_1 Q1_2');
  });

  it('라벨은 작은따옴표를 이중으로 escape한다', () => {
    const questions = [checkboxManual];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    expect(syntax).toContain("LABEL='이용 매체를 모두 고르세요. ''복수응답'''");
  });

  it('Case A 테이블소스 checkbox도 export와 동일한 변수명으로 묶는다', () => {
    const questions = [checkboxTableSource];
    const columns = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(columns, questions);
    expect(syntax).toContain('/MCGROUP NAME=$Q2');
    expect(syntax).toContain('VARIABLES=Q2_1 Q2_2');
    const exported = columns.filter((c) => c.type === 'checkbox-item').map((c) => c.spssVarName);
    expect(exported).toEqual(['Q2_1', 'Q2_2']);
  });

  it('radio 질문은 세트를 만들지 않는다', () => {
    const questions = [radioQuestion];
    expect(generateMrsetsSyntax(generateSPSSColumns(questions), questions)).toBeNull();
  });

  it('checkbox 질문이 없으면 null을 반환한다', () => {
    expect(generateMrsetsSyntax([], [])).toBeNull();
  });

  it('명령은 마침표로 끝난다', () => {
    const questions = [checkboxManual];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    expect(syntax?.trimEnd().endsWith('.')).toBe(true);
  });

  it('_text 사이드카와 _etc 변수는 세트에 포함하지 않는다', () => {
    const withText = q({
      id: 'q4',
      questionCode: 'Q4',
      type: 'checkbox',
      allowOtherOption: true,
      options: [
        { id: 'o1', label: 'A', value: 'o1', optionCode: '1', spssNumericCode: 1, allowTextInput: true },
      ],
    });
    const questions = [withText];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    expect(syntax).toContain('VARIABLES=Q4_1.');
    expect(syntax).not.toContain('_text');
    expect(syntax).not.toContain('_etc');
  });
});

describe('generateMrsetsSyntax - 테이블 checkbox 셀 단위 MCGROUP', () => {
  const tableQuestion = q({
    id: 'q5',
    questionCode: 'T1',
    type: 'table',
    tableColumns: [{ id: 'c1', label: '열1' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '행1',
        cells: [
          {
            id: 'cellCb',
            content: '',
            type: 'checkbox',
            cellCode: 'T1_r1_c1',
            exportLabel: 'T1_열1_행1',
            checkboxOptions: [
              { id: 'co1', label: '보기A', value: 'co1', spssNumericCode: 5 },
              { id: 'co2', label: '보기B', value: 'co2', spssNumericCode: 7 },
            ],
          },
        ],
      },
      {
        id: 'r2',
        label: '행2',
        cells: [
          {
            id: 'cellRadio',
            content: '',
            type: 'radio',
            cellCode: 'T1_r2_c1',
            radioOptions: [{ id: 'ro1', label: 'R', value: 'ro1', spssNumericCode: 1 }],
          },
        ],
      },
    ],
  });

  it('checkbox 셀마다 cellCode 이름으로 MCGROUP을 만들고 변수명은 export와 일치한다', () => {
    const questions = [tableQuestion];
    const columns = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(columns, questions);

    const cellVars = columns
      .filter((c) => c.tableCellId === 'cellCb' && c.tableCellType === 'checkbox')
      .map((c) => c.spssVarName);
    expect(cellVars.length).toBe(2);
    expect(syntax).toContain(
      `/MCGROUP NAME=$T1_r1_c1 LABEL='T1_열1_행1' VARIABLES=${cellVars.join(' ')}`,
    );
  });

  it('radio 셀은 세트를 만들지 않는다', () => {
    const questions = [tableQuestion];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    expect(syntax).not.toContain('T1_r2_c1');
  });

  it('cellCode가 없는 checkbox 셀은 건너뛴다', () => {
    const noCode = q({
      id: 'q6',
      questionCode: 'T2',
      type: 'table',
      tableColumns: [{ id: 'c1', label: '열1' }],
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            {
              id: 'cellX',
              content: '',
              type: 'checkbox',
              checkboxOptions: [{ id: 'o1', label: 'A', value: 'o1', spssNumericCode: 1 }],
            },
          ],
        },
      ],
    });
    const questions = [noCode];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    if (syntax !== null) {
      expect(syntax).not.toContain('$undefined');
    }
  });

  it('질문 세트와 셀 세트가 공존할 때 마지막 줄에만 마침표가 붙는다', () => {
    const questions = [checkboxManual, tableQuestion];
    const syntax = generateMrsetsSyntax(generateSPSSColumns(questions), questions);
    expect(syntax).not.toBeNull();
    const mcgroupLines = syntax!.split('\n').filter((l) => l.includes('/MCGROUP'));
    expect(mcgroupLines.length).toBe(2);
    expect(mcgroupLines[0]!.endsWith('.')).toBe(false);
    expect(mcgroupLines[1]!.endsWith('.')).toBe(true);
  });
});
