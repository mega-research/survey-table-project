import { describe, expect, it } from 'vitest';

import {
  SCALE_BAR_FALLBACK_MESSAGES,
  diagnoseChoiceGroupScaleBar,
  diagnoseRowScaleBars,
} from '@/features/survey-builder/lib/scale-bar-diagnostics';
import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const satisfaction: ChoiceGroup = { id: 'g-sat', groupKey: 'rad2', type: 'radio', label: '만족도' };

const choice = (id: string, content: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g-sat',
  ...extra,
});

function scaleRow(
  id: string,
  label: string,
  edit: (cell: TableCell, n: number) => TableCell = (cell) => cell,
): TableRow {
  return {
    id,
    label,
    cells: [
      { id: `${id}-item`, type: 'text', content: label },
      ...CIRC.map((text, n) => edit(choice(`${id}-c${n}`, text), n)),
    ],
  };
}

const columns: TableColumn[] = Array.from({ length: 12 }, (_, n) => ({ id: `col${n}`, label: '' }));

describe('diagnoseChoiceGroupScaleBar — 척도 막대 그룹의 폴백 진단', () => {
  it('모든 행이 막대로 그려지면 문제가 없다', () => {
    const rows = [scaleRow('r1', '회의실 지원'), scaleRow('r2', '교통비 지원')];
    expect(diagnoseChoiceGroupScaleBar({ group: satisfaction, rows, columns })).toEqual([]);
  });

  it('폴백하는 행을 이유별로 모아 행 이름과 문구를 준다', () => {
    const rows = [
      scaleRow('r1', '회의실 지원', (cell, n) =>
        n === 10 ? { ...cell, allowTextInput: true } : cell,
      ),
      scaleRow('r2', '교통비 지원'),
      scaleRow('r3', '멘토링', (cell, n) => (n === 10 ? { ...cell, allowTextInput: true } : cell)),
    ];
    expect(diagnoseChoiceGroupScaleBar({ group: satisfaction, rows, columns })).toEqual([
      {
        reason: 'text-input',
        message: SCALE_BAR_FALLBACK_MESSAGES['text-input'],
        rowLabels: ['회의실 지원', '멘토링'],
      },
    ]);
  });

  it('복수 선택 그룹은 이유 하나로 모든 행을 알린다', () => {
    const rows = [scaleRow('r1', '회의실 지원'), scaleRow('r2', '교통비 지원')];
    const issues = diagnoseChoiceGroupScaleBar({
      group: { ...satisfaction, type: 'checkbox' },
      rows,
      columns,
    });
    expect(issues.map((issue) => issue.reason)).toEqual(['not-single-choice']);
    expect(issues[0]!.rowLabels).toEqual(['회의실 지원', '교통비 지원']);
  });

  it('행 이름이 없으면 첫 글자 칸, 그것도 없으면 행 번호', () => {
    const noLabel = { ...scaleRow('r1', '회의실 지원'), label: '' };
    const bare: TableRow = {
      id: 'r2',
      label: '',
      cells: [
        { id: 'r2-item', type: 'text', content: '' },
        ...CIRC.map((_, n) => choice(`r2-c${n}`, '')),
      ],
    };
    const issues = diagnoseChoiceGroupScaleBar({
      group: satisfaction,
      rows: [noLabel, bare],
      columns,
    });
    expect(issues).toEqual([
      expect.objectContaining({ reason: 'missing-text', rowLabels: ['2행'] }),
    ]);
    const onlyFirst = diagnoseChoiceGroupScaleBar({
      group: satisfaction,
      rows: [
        {
          ...noLabel,
          cells: noLabel.cells.map((cell, n) => (n === 5 ? { ...cell, content: '' } : cell)),
        },
      ],
      columns,
    });
    expect(onlyFirst[0]!.rowLabels).toEqual(['회의실 지원']);
  });

  it('그룹 칸이 없는 행과 숨은 칸은 보지 않는다', () => {
    const rows = [
      { id: 'head', label: '구분', cells: [{ id: 'h', type: 'text' as const, content: '구분' }] },
      scaleRow('r1', '회의실 지원', (cell, n) =>
        n === 10 ? { ...cell, allowTextInput: true, isHidden: true } : cell,
      ),
    ];
    expect(diagnoseChoiceGroupScaleBar({ group: satisfaction, rows, columns })).toEqual([]);
  });

  it('이유 코드마다 한국어 문구가 있다', () => {
    for (const message of Object.values(SCALE_BAR_FALLBACK_MESSAGES)) {
      expect(message.trim()).not.toBe('');
    }
  });
});

describe('diagnoseRowScaleBars — 「행별 척도」의 폴백 행 진단', () => {
  const groups = ['r1', 'r2', 'r3'].map((id): ChoiceGroup => ({
    id: `g-${id}`,
    groupKey: `rad-${id}`,
    type: 'radio',
    label: '',
    mobileScaleBar: true,
  }));
  const d1Row = (id: string, label: string, extra: TableCell[] = []): TableRow => ({
    id,
    label,
    cells: [
      { id: `${id}-item`, type: 'text', content: label },
      ...CIRC.map((text, n) => choice(`${id}-c${n}`, text, { choiceGroupId: `g-${id}` })),
      ...extra,
    ],
  });
  const base = {
    columns: [...columns, { id: 'extra', label: '' }],
    choiceGroups: groups,
    ungroupedSelectionType: null,
    hideColumnLabels: false,
    omitLeadingColumns: 1,
  };

  it('모든 행이 막대로 그려지면 문제가 없다', () => {
    const rows = [
      d1Row('r1', '전문성', [{ id: 'r1-x', type: 'text', content: '' }]),
      d1Row('r2', '시간', [{ id: 'r2-x', type: 'text', content: '' }]),
    ];
    expect(diagnoseRowScaleBars({ ...base, rows })).toEqual([]);
  });

  it('막대로 고른 그룹을 못 그리는 행을 이유별로 알린다 — 입력칸은 원본 조각으로 남아 문제가 아니다', () => {
    const rows = [
      d1Row('r1', '전문성', [{ id: 'r1-memo', type: 'input', content: '' }]),
      d1Row('r2', '시간', [{ id: 'r2-x', type: 'text', content: '' }]),
      {
        ...d1Row('r3', '자료', [{ id: 'r3-x', type: 'text', content: '' }]),
      },
    ];
    rows[2]!.cells[11] = { ...rows[2]!.cells[11]!, exclusiveChoice: true };
    expect(diagnoseRowScaleBars({ ...base, rows })).toEqual([
      {
        reason: 'exclusive-choice',
        message: SCALE_BAR_FALLBACK_MESSAGES['exclusive-choice'],
        rowLabels: ['자료'],
      },
    ]);
  });

  it('막대로 고르지 않은 그룹은 원래 형태가 의도라 알리지 않는다', () => {
    const rows = [d1Row('r1', '전문성', [{ id: 'r1-x', type: 'text', content: '' }])];
    rows[0]!.cells[11] = { ...rows[0]!.cells[11]!, allowTextInput: true };
    const tiles = groups.map(({ mobileScaleBar: _bar, ...group }) => group);
    expect(diagnoseRowScaleBars({ ...base, rows, choiceGroups: tiles })).toEqual([]);
  });

  it('보기 칸이 없는 행(입력칸만 있는 행)은 척도가 아니라 알리지 않는다', () => {
    const rows = [
      {
        id: 'memo',
        label: '기타 의견',
        cells: [
          { id: 'memo-item', type: 'text' as const, content: '기타 의견' },
          { id: 'memo-input', type: 'input' as const, content: '' },
          ...Array.from({ length: 11 }, (_, n) => ({
            id: `memo-b${n}`,
            type: 'text' as const,
            content: '',
          })),
        ],
      },
    ];
    expect(diagnoseRowScaleBars({ ...base, rows })).toEqual([]);
  });

  it('보기 소스 표의 checkbox 문항은 그룹 없는 보기 칸 행을 복수 선택으로 알린다', () => {
    const rows = [
      {
        id: 'r1',
        label: '전문성',
        cells: [
          { id: 'r1-item', type: 'text' as const, content: '전문성' },
          ...CIRC.map((text, n) => ({
            id: `r1-c${n}`,
            type: 'choice_opt' as const,
            content: text,
          })),
          { id: 'r1-x', type: 'text' as const, content: '' },
        ],
      },
    ];
    expect(
      diagnoseRowScaleBars({ ...base, rows, choiceGroups: [], ungroupedSelectionType: 'checkbox' }),
    ).toEqual([expect.objectContaining({ reason: 'not-single-choice', rowLabels: ['전문성'] })]);
  });
});
