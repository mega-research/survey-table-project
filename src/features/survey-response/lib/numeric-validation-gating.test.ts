import { describe, expect, it } from 'vitest';

import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import type { Question } from '@/types/survey';

// 수행(1)/미수행(2) radio + 게이팅된 필수 인력 input
function gatedTable(requiredWhenEnabled: boolean): Question {
  return {
    id: 'q1',
    type: 'table',
    title: 'T',
    required: false,
    order: 1,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          {
            id: 'perf',
            content: '',
            type: 'radio',
            radioOptions: [
              { id: 'o1', label: '수행', value: '1' },
              { id: 'o2', label: '미수행', value: '2' },
            ],
          },
          {
            id: 'men',
            content: '',
            type: 'input',
            inputType: 'number',
            enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] },
            ...(requiredWhenEnabled ? { requiredWhenEnabled: true } : {}),
          },
        ],
      },
    ],
  } as Question;
}

// 수행(1)/미수행(2) radio + 게이팅된 radio(기타 상세기입, requiredWhenEnabled)
function gatedTableWithDetailCell(): Question {
  return {
    id: 'q1',
    type: 'table',
    title: 'T',
    required: false,
    order: 1,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          {
            id: 'perf',
            content: '',
            type: 'radio',
            radioOptions: [
              { id: 'o1', label: '수행', value: '1' },
              { id: 'o2', label: '미수행', value: '2' },
            ],
          },
          {
            id: 'detail',
            content: '',
            type: 'radio',
            required: false,
            requiredWhenEnabled: true,
            enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] },
            radioOptions: [
              { id: 'other', label: '기타', value: 'other-value', allowTextInput: true },
            ],
          },
        ],
      },
    ],
  } as Question;
}

describe('게이팅 검증', () => {
  it('활성인데 requiredWhenEnabled 셀이 비면 required-cells issue', () => {
    const issues = collectNumericIssues(gatedTable(true), { perf: '1' });
    expect(issues.some((i) => i.kind === 'required-cells' && i.cellIds?.includes('men'))).toBe(
      true,
    );
  });

  it('비활성이면 필수 검사를 하지 않는다', () => {
    expect(
      collectNumericIssues(gatedTable(true), { perf: '2' }).filter(
        (i) => i.kind === 'required-cells',
      ),
    ).toEqual([]);
  });

  it('컨트롤러 미응답 = 비활성 — 필수 검사 없음', () => {
    expect(
      collectNumericIssues(gatedTable(true), {}).filter((i) => i.kind === 'required-cells'),
    ).toEqual([]);
  });

  it('기존 required=true 도 게이팅 셀에서는 활성일 때만 필수', () => {
    const q = gatedTable(false);
    const men = q.tableRowsData![0]!.cells[1]!;
    men.required = true;
    expect(
      collectNumericIssues(q, { perf: '2' }).filter((i) => i.kind === 'required-cells'),
    ).toEqual([]);
    expect(collectNumericIssues(q, { perf: '1' }).some((i) => i.kind === 'required-cells')).toBe(
      true,
    );
  });

  it('비활성 셀은 min 범위 검증에서도 제외된다', () => {
    const q = gatedTable(false);
    const men = q.tableRowsData![0]!.cells[1]!;
    men.numberFormat = { min: 10 };
    // 비활성인데 잔존 값 5 (strip 전 순간) — 범위 위반으로 차단하면 안 됨
    expect(
      collectNumericIssues(q, { perf: '2', men: '5' }).filter((i) => i.kind === 'range'),
    ).toEqual([]);
  });

  it('활성 + requiredWhenEnabled 상세기입 셀은 옵션 선택 시 텍스트 누락도 required-cells issue', () => {
    // perf 는 응답됐고 detail 도 값이 있어 hasAnyCellValue 얼리리턴을 피한다 —
    // 컨트롤러(perf)는 응답이 있으므로 detail 은 활성.
    const issues = collectNumericIssues(gatedTableWithDetailCell(), {
      perf: '1',
      detail: 'other-value',
    });
    expect(issues.some((i) => i.kind === 'required-cells' && i.cellIds?.includes('detail'))).toBe(
      true,
    );
  });

  it('비활성 게이팅 셀은 상세기입이 비어도 required-cells issue 없음 — 컨트롤러만 무응답', () => {
    // 행 내 다른 셀(detail)엔 잔존 값이 있지만 컨트롤러(perf)는 무응답 — hasAnyCellValue 는
    // detail 값으로 충족되므로 얼리리턴 없이 게이팅 로직이 실제로 행사된다.
    const issues = collectNumericIssues(gatedTableWithDetailCell(), {
      detail: 'other-value',
    });
    expect(issues.filter((i) => i.kind === 'required-cells')).toEqual([]);
  });
});
