import { VariableType } from 'sav-writer';
import { describe, expect, it } from 'vitest';

import { normalizeQuestions } from '@/lib/question';
import { resolveVarType } from '@/lib/spss/variable-meta';
import type { Question, SurveySubmission } from '@/types/survey';

import { buildDataRows, generateSPSSColumns } from './spss-excel-export';

/**
 * 고친 경우만 따로 내보내기 — 고칠 수 있는 프리필 칸 옆 `<변수>_upd` 열은 응답 확정이 「명단 값과 다르게 냈다」
 * 표식(`__prefillEdits__`)을 단 응답에서만 채워진다. 원 변수는 그대로다(웹 버전의 「수정 전화번호」).
 */
const question = normalizeQuestions([
  {
    id: 'q-sq1',
    type: 'table',
    title: '일반현황',
    order: 0,
    required: false,
    questionCode: 'SQ1',
    isCustomSpssVarName: true,
    tableColumns: [
      { id: 'c1', label: '라벨', columnCode: 'c01' },
      { id: 'c2', label: '입력', columnCode: 'c02' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '사업체 전화번호',
        rowCode: 'r05',
        cells: [
          { id: 'lab', type: 'text', content: '사업체 전화번호' },
          {
            id: 'phone',
            type: 'input',
            content: '',
            exportLabel: '사업체 전화번호',
            isCustomExportLabel: true,
            defaultValueTemplate: '{{전화번호}}',
            prefillEditable: true,
            exportPrefillEdit: true,
          },
        ],
      },
    ],
  },
] as unknown as Question[]);

const sub = (responses: Record<string, unknown>): SurveySubmission =>
  ({ id: 's', surveyId: 'x', startedAt: new Date(), isCompleted: true, updatedAt: new Date(), questionResponses: responses }) as SurveySubmission;

describe('고친 프리필 내보내기 열', () => {
  const columns = generateSPSSColumns(question);

  it('원 변수 바로 옆에 _upd 열이 선다 — 라벨은 (수정값)', () => {
    const names = columns.map((c) => c.spssVarName);
    const i = names.findIndex((n) => n.endsWith('_upd'));
    expect(i).toBeGreaterThan(0);
    expect(names[i]).toBe(`${names[i - 1]}_upd`);
    expect(columns[i]!.cellExportLabel).toBe('사업체 전화번호 (수정값)');
  });

  it('표식이 있으면 고친 값을, 없으면 비운다 — 원 변수는 늘 응답 값', () => {
    const [edited, untouched] = buildDataRows(columns, question, [
      sub({ 'q-sq1': { phone: '02-222-2222' }, __prefillEdits__: { 'q-sq1': ['phone'] } }),
      sub({ 'q-sq1': { phone: '02-111-1111' } }),
    ]);
    const i = columns.findIndex((c) => c.type === 'prefill-edit');
    expect(edited![i]).toBe('02-222-2222');
    expect(edited![i - 1]).toBe('02-222-2222');
    expect(untouched![i]).toBeNull();
    expect(untouched![i - 1]).toBe('02-111-1111');
  });

  it('.sav 에서는 문자 변수다', () => {
    const col = columns.find((c) => c.type === 'prefill-edit')!;
    expect(resolveVarType(col, question[0])).toBe(VariableType.String);
  });

  it('옵션을 끈 칸에는 _upd 열이 없다', () => {
    const base = question[0] as unknown as Question;
    const off = normalizeQuestions([
      { ...base, tableRowsData: base.tableRowsData!.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, exportPrefillEdit: false })) })) },
    ] as unknown as Question[]);
    expect(generateSPSSColumns(off).some((c) => c.type === 'prefill-edit')).toBe(false);
  });
});
