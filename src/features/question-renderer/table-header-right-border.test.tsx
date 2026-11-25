import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';
import { TablePreview } from './table-preview';

/**
 * 머리글 오른쪽 세로선 숨김(`HeaderCell.hideRightBorder` · `TableColumn.hideRightBorder`) — 응답 화면과
 * 미리보기가 같은 규칙으로 선을 지운다. 표의 마지막 열에 닿는 칸은 켜도 지우지 않는다(표의 오른쪽 끝선).
 * 빌더 편집 격자가 선을 그대로 그리는 것은 survey-builder 의 header-cell-style 테스트가 본다.
 */
beforeAll(() => {
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const LABELS = ['전혀 만족하지 않음', '낮음', '보통', '높음', '매우 만족함'];

const columns = (hidden: readonly number[] = []): TableColumn[] =>
  LABELS.map((label, n) => ({
    id: `c${n}`,
    label,
    width: 100,
    ...(hidden.includes(n) ? { hideRightBorder: true } : {}),
  }));

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: LABELS.map((_, n) => ({ id: `r1-c${n}`, type: 'text', content: String(n + 1) })),
  },
];

/** 위 줄은 묶음 제목(앞 두 열 · 뒤 세 열), 아래 줄은 열마다 한 칸 */
const grid = (hidden: readonly string[] = []): HeaderCell[][] => {
  const cell = (id: string, label: string, colspan: number): HeaderCell => ({
    id,
    label,
    colspan,
    rowspan: 1,
    ...(hidden.includes(id) ? { hideRightBorder: true } : {}),
  });
  return [
    [cell('top-a', '부정', 2), cell('top-b', '긍정', 3)],
    LABELS.map((label, n) => cell(`h${n}`, label, 1)),
  ];
};

const header = (name: string) => screen.getByRole('columnheader', { name });

const surfaces = [
  {
    name: '응답 화면',
    draw: (tableColumns: TableColumn[], headerGrid?: HeaderCell[][]) =>
      render(
        <InteractiveTableResponse
          questionId="q1"
          columns={tableColumns}
          rows={rows}
          tableHeaderGrid={headerGrid}
          value={{}}
          onChange={() => {}}
          enableSticky={false}
        />,
      ),
  },
  {
    name: '미리보기',
    draw: (tableColumns: TableColumn[], headerGrid?: HeaderCell[][]) =>
      render(<TablePreview columns={tableColumns} rows={rows} tableHeaderGrid={headerGrid} />),
  },
];

describe.each(surfaces)('머리글 오른쪽 세로선 숨김 — $name', ({ draw }) => {
  it('켠 다단 헤더 칸만 오른쪽 선이 지워지고 아래 선과 이웃 칸의 선은 그대로다', () => {
    draw(columns(), grid(['h0', 'h1']));
    expect(header('전혀 만족하지 않음')).toHaveClass('border-r-0', 'border-b');
    expect(header('낮음')).toHaveClass('border-r-0');
    expect(header('보통')).not.toHaveClass('border-r-0');
    expect(header('보통')).toHaveClass('border-r');
  });

  it('여러 열을 덮는 칸도 켜면 오른쪽 선이 지워진다', () => {
    draw(columns(), grid(['top-a']));
    expect(header('부정')).toHaveClass('border-r-0');
    expect(header('긍정')).not.toHaveClass('border-r-0');
  });

  it('표의 마지막 열에 닿는 칸은 켜도 선이 남는다 — 한 칸짜리도 여러 열을 덮는 칸도', () => {
    draw(columns(), grid(['top-b', 'h3', 'h4']));
    expect(header('높음')).toHaveClass('border-r-0');
    expect(header('매우 만족함')).not.toHaveClass('border-r-0');
    expect(header('긍정')).not.toHaveClass('border-r-0');
  });

  it('다단 헤더가 없는 표는 열의 설정을 읽는다', () => {
    draw(columns([0, 4]));
    expect(header('전혀 만족하지 않음')).toHaveClass('border-r-0');
    expect(header('낮음')).not.toHaveClass('border-r-0');
    // 마지막 열
    expect(header('매우 만족함')).not.toHaveClass('border-r-0');
  });

  it('설정이 없는 표의 머리글은 선이 전부 그대로다', () => {
    draw(columns(), grid());
    for (const cell of screen.getAllByRole('columnheader')) {
      expect(cell).toHaveClass('border-r');
      expect(cell).not.toHaveClass('border-r-0');
    }
  });
});
