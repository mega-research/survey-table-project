import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import {
  getMobileOriginalRowLabel,
  isMobileOriginalRowInteractiveCell,
  projectMobileOriginalRow,
} from '@/utils/mobile-original-row';

const col = (id: string): TableColumn => ({ id, label: id });
const header = (id: string, colspan = 1, rowspan = 1): HeaderCell => ({
  id,
  label: id,
  colspan,
  rowspan,
});
const text = (id: string, content = id, rowspan?: number): TableCell => ({
  id,
  type: 'text',
  content,
  ...(rowspan ? { rowspan } : {}),
});
const radio = (id: string): TableCell => ({
  id,
  type: 'radio',
  content: '',
  radioOptions: [{ id: `${id}-1`, label: '1점', value: '1' }],
});
const row = (id: string, cells: TableCell[]): TableRow => ({ id, label: id, cells });

describe('projectMobileOriginalRow', () => {
  it('작성 열 2개를 제외하고 조건으로 숨은 열 때문에 다음 가시 열을 더 제외하지 않는다', () => {
    const projection = projectMobileOriginalRow({
      authoredColumns: [col('c0'), col('c1'), col('c2'), col('c3')],
      visibleColumns: [col('c0'), col('c2'), col('c3')],
      visibleHeaderGrid: [[header('항목', 1), header('척도', 2)]],
      displayRows: [row('r1', [text('a'), radio('v2'), radio('v3')])],
      selectedRowId: 'r1',
      omitLeadingAuthoredColumns: 2,
    });

    expect(projection?.columns.map((column) => column.id)).toEqual(['c2', 'c3']);
    expect(projection?.row.cells.map((cell) => cell.id)).toEqual(['v2', 'v3']);
  });

  it('본문 rowspan은 1로 만들고 다단 헤더 rowspan은 유지한다', () => {
    const columns = [col('c0'), col('c1'), col('c2')];
    const projection = projectMobileOriginalRow({
      authoredColumns: columns,
      visibleColumns: columns,
      visibleHeaderGrid: [
        [header('h0'), header('h1', 1, 2), header('h2')],
        [header('h3')],
      ],
      displayRows: [
        row('r1', [text('label'), { ...radio('v1'), rowspan: 2 }, radio('v2')]),
      ],
      selectedRowId: 'r1',
      omitLeadingAuthoredColumns: 1,
    });

    expect(projection?.row.cells.every((cell) => (cell.rowspan ?? 1) === 1)).toBe(true);
    expect(projection?.headerGrid?.[0]?.[0]?.rowspan).toBe(2);
  });

  it('interactive가 없으면 fallback 신호를 반환한다', () => {
    expect(
      projectMobileOriginalRow({
        authoredColumns: [col('c0'), col('c1')],
        visibleColumns: [col('c0'), col('c1')],
        displayRows: [row('r1', [text('label'), text('description')])],
        selectedRowId: 'r1',
        omitLeadingAuthoredColumns: 1,
      })?.hasInteractiveCells,
    ).toBe(false);
  });
});

describe('getMobileOriginalRowLabel', () => {
  it('명시적으로 숨긴 text가 row.label과 같으면 choice title로 fallback한다', () => {
    const hiddenLabel = { ...text('label', '숨긴 제목'), mobileDisplay: 'hidden' as const };
    const choice: TableCell = { id: 'choice', type: 'choice_opt', content: '' };

    expect(
      getMobileOriginalRowLabel({
        authoredColumns: [col('c0'), col('c1')],
        row: { id: 'r1', label: '숨긴 제목', cells: [hiddenLabel, choice] },
        omitLeadingAuthoredColumns: 1,
        resolveChoiceLabel: (cellId) => (cellId === 'choice' ? '선택지 제목' : undefined),
      }),
    ).toBe('선택지 제목');
  });

  it.each(['text', 'image', 'video'] as const)(
    '행 전체의 mobileDisplay hidden %s 콘텐츠는 row.label로 다시 노출하지 않는다',
    (type) => {
      const hiddenStatic: TableCell = {
        id: 'hidden-static',
        type,
        content: '행 전체 숨김 제목',
        mobileDisplay: 'hidden',
      };

      expect(
        getMobileOriginalRowLabel({
          authoredColumns: [col('c0'), col('c1')],
          row: {
            id: 'r1',
            label: '행 전체 숨김 제목',
            cells: [text('empty', ''), hiddenStatic],
          },
          omitLeadingAuthoredColumns: 1,
          resolveChoiceLabel: () => undefined,
        }),
      ).toBe('(라벨 없음)');
    },
  );

  it('mobileDisplay hidden choice_opt는 건너뛰고 다음 가시 choice를 fallback으로 쓴다', () => {
    const hiddenChoice: TableCell = {
      id: 'hidden-choice',
      type: 'choice_opt',
      content: '',
      mobileDisplay: 'hidden',
    };
    const visibleChoice: TableCell = {
      id: 'visible-choice',
      type: 'choice_opt',
      content: '',
    };

    expect(
      getMobileOriginalRowLabel({
        authoredColumns: [col('c0'), col('c1'), col('c2')],
        row: {
          id: 'r1',
          label: '',
          cells: [text('empty', ''), hiddenChoice, visibleChoice],
        },
        omitLeadingAuthoredColumns: 1,
        resolveChoiceLabel: (cellId) =>
          cellId === 'hidden-choice' ? '숨긴 선택지' : '가시 선택지',
      }),
    ).toBe('가시 선택지');
  });

  it('mobileDisplay hidden interactive 셀도 응답 컨트롤 대상이다', () => {
    const hiddenChoice: TableCell = {
      id: 'hidden-choice',
      type: 'choice_opt',
      content: '',
      mobileDisplay: 'hidden',
    };

    expect(isMobileOriginalRowInteractiveCell(hiddenChoice)).toBe(true);
  });

  it('제외 열의 가시 text 후보는 오른쪽 값을 우선한다', () => {
    expect(
      getMobileOriginalRowLabel({
        authoredColumns: [col('c0'), col('c1'), col('c2')],
        row: {
          id: 'r1',
          label: '',
          cells: [text('left', '왼쪽'), text('right', '오른쪽'), radio('value')],
        },
        omitLeadingAuthoredColumns: 2,
        resolveChoiceLabel: () => undefined,
      }),
    ).toBe('오른쪽');
  });
});
