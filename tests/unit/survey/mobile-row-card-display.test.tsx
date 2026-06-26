import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';
import { MobileRowCard } from '@/components/survey-builder/mobile-row-card';

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 100 },
  { id: 'c1', label: '설명', width: 200 },
  { id: 'c2', label: '점수', width: 100 },
];

function row(mobileDisplay?: 'hidden' | 'inline' | 'collapsed'): TableRow {
  return {
    id: 'r1',
    label: '가격',
    cells: [
      { id: 'r1c0', type: 'radio', radioOptions: [{ id: 'o', label: '가격', value: 'v' }] } as never,
      { id: 'r1c1', type: 'text', content: '가격 설명', mobileDisplay } as never,
      { id: 'r1c2', type: 'input' } as never,
    ],
  } as TableRow;
}

function renderCard(r: TableRow) {
  return render(
    <MobileRowCard
      row={r}
      visibleColumns={columns}
      columnSectionMap={null}
      completed={false}
      hideColumnLabels={false}
      questionId="q1"
      isTestMode={false}
    />,
  );
}

describe('MobileRowCard 표시 셀', () => {
  it('미지정(기본 hidden) text 셀은 카드에 노출되지 않는다 (회귀)', () => {
    renderCard(row(undefined));
    expect(screen.queryByText('가격 설명')).not.toBeInTheDocument();
  });

  it('명시 hidden text 셀이 있으면 row.label 폴백 헤더를 렌더하지 않는다', () => {
    renderCard({
      id: 'r1',
      label: '숨겨야 하는 카드 제목',
      cells: [
        {
          id: 'r1c0',
          type: 'text',
          content: '숨겨야 하는 카드 제목',
          mobileDisplay: 'hidden',
        } as never,
        { id: 'r1c2', type: 'input' } as never,
      ],
    } as TableRow);

    expect(screen.queryByText('숨겨야 하는 카드 제목')).not.toBeInTheDocument();
  });

  it('inline 지정 text 셀은 카드에 노출된다', () => {
    renderCard(row('inline'));
    expect(screen.getByText('가격 설명')).toBeInTheDocument();
  });

  it('collapsed 지정 text 셀은 "자세히" 토글 뒤 노출된다', () => {
    renderCard(row('collapsed'));
    expect(screen.queryByText('가격 설명')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /자세히/ })).toBeInTheDocument();
  });
});

describe('MobileRowCard 인터랙티브 셀 라벨', () => {
  function labelRow(): TableRow {
    return {
      id: 'r1',
      label: '설립연도',
      cells: [
        { id: 'y', type: 'input', exportLabel: '설립연도_년', placeholder: 'ex) 1994' } as never,
        { id: 'm', type: 'input', placeholder: 'ex) 12' } as never,
      ],
    } as TableRow;
  }

  function renderWith(hideColumnLabels: boolean) {
    return render(
      <MobileRowCard
        row={labelRow()}
        visibleColumns={columns}
        columnSectionMap={null}
        completed={false}
        hideColumnLabels={hideColumnLabels}
        questionId="q1"
        isTestMode={false}
      />,
    );
  }

  it('hideColumnLabels 여도 exportLabel 이 표기된다', () => {
    renderWith(true);
    expect(screen.getByText('설립연도_년')).toBeInTheDocument();
  });

  it('hideColumnLabels 이고 exportLabel 이 없는 셀은 라벨을 표기하지 않는다', () => {
    renderWith(true);
    // placeholder 만 있는 m 셀은 exportLabel 이 없어 열 라벨('점수')로 폴백하지 않아야 한다
    expect(screen.queryByText('점수')).not.toBeInTheDocument();
  });

  it('mobileDisplay hidden 인 인터랙티브 셀은 라벨만 숨기고 입력 컨트롤은 유지한다', () => {
    renderCard({
      id: 'r1',
      label: '설립연도',
      cells: [
        {
          id: 'y',
          type: 'input',
          exportLabel: '숨길엑셀라벨',
          placeholder: 'ex) 1994',
          mobileDisplay: 'hidden',
        } as never,
      ],
    } as TableRow);

    expect(screen.queryByText('숨길엑셀라벨')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('ex) 1994')).toBeInTheDocument();
  });
});
