/**
 * 후속 리뷰 Task A — 모바일 표 스테퍼(mobile-table-stepper.tsx)의 응답 인용 치환.
 *
 * mobile-table-stepper.tsx 에는 substituteTokens 호출이 하나도 없어서, 사전선택
 * phase(그룹 선택·행 선택)와 기존 스테퍼(그룹 pill·행 pill·현재 그룹 헤더)의
 * row.label / group.label 이 {{{인용}}} 원문 그대로 노출됐다. 같은 표의 셀은 이미
 * 치환된 값을 보여주므로 화면 하나에 치환/미치환이 섞였다.
 *
 * 형제 컴포넌트 mobile-table-drilldown.tsx 의 배선(메모이즈된 치환 라벨)을 그대로 따른다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { MobileTableStepper } from '@/components/survey-builder/mobile-table-stepper';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { TableColumn, TableRow } from '@/types/survey';

// jsdom 은 scrollIntoView 를 구현하지 않는다 — pill 자동 스크롤 useEffect 가 그룹/행
// 전환마다 호출한다.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 140 },
  { id: 'c1', label: '응답', width: 140 },
];

// SMALL_TABLE_THRESHOLD(15) 초과라야 사전선택/기존 스테퍼 phase 로 들어간다(그 이하는
// 단순 카드 목록으로 조기 반환). 그룹당 8행 × 2그룹 = 16행, rowGroups.length=2 라
// skipGroupSelect 도 false 가 되어 그룹 선택 phase 부터 시작한다.
function buildGroupRows(groupIdx: number, count: number): TableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `g${groupIdx}-r${i}`,
    label: `{{{인용}}} 행${groupIdx}-${i}`,
    cells: [
      i === 0
        ? {
            id: `g${groupIdx}-r${i}-c0`,
            type: 'text',
            content: `{{{인용}}} 그룹${groupIdx}`,
            rowspan: count,
          }
        : {
            id: `g${groupIdx}-r${i}-c0`,
            type: 'text',
            content: `{{{인용}}} 그룹${groupIdx}`,
            _isContinuation: true,
          },
      {
        id: `g${groupIdx}-r${i}-c1`,
        type: 'radio',
        content: '',
        // 옵션 2개 — getRowShortLabel 의 "라디오 옵션 1개짜리는 라벨만" 분기를 피해
        // row.label 치환 분기를 타게 한다.
        radioOptions: [
          { id: 'o1', label: '예', value: '1' },
          { id: 'o2', label: '아니오', value: '2' },
        ],
      },
    ],
  })) as unknown as TableRow[];
}

const rows: TableRow[] = [...buildGroupRows(0, 8), ...buildGroupRows(1, 8)];

function renderStepper(hasDynamicRows: boolean) {
  return render(
    <ContactAttrsProvider attrs={{}} quotes={{ 인용: '홍길동' }}>
      <MobileTableStepper
        questionId="q1"
        displayRows={rows}
        visibleColumns={columns}
        currentResponse={{}}
        hideColumnLabels={false}
        isTestMode
        hasDynamicRows={hasDynamicRows}
        selectedRowIds={[]}
        groupConfigMap={new Map()}
      />
    </ContactAttrsProvider>,
  );
}

describe('모바일 표 스테퍼 — 응답 인용 치환', () => {
  it('그룹 선택 phase 의 그룹 라벨을 치환한다', () => {
    renderStepper(false);

    expect(screen.getByText('홍길동 그룹0')).toBeInTheDocument();
    expect(screen.getByText('홍길동 그룹1')).toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 그룹0')).not.toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 그룹1')).not.toBeInTheDocument();
  });

  it('행 선택 phase 의 그룹 헤더와 행 라벨을 치환한다', () => {
    renderStepper(false);

    const checkbox = screen
      .getByText('홍길동 그룹0')
      .closest('label')
      ?.querySelector('input[type="checkbox"]');
    if (!checkbox) throw new Error('그룹0 체크박스를 찾지 못했다');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /상세 입력/ }));

    expect(screen.getByText('홍길동 그룹0')).toBeInTheDocument();
    expect(screen.getByText('홍길동 행0-0')).toBeInTheDocument();
    expect(screen.getByText('홍길동 행0-7')).toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 행0-0')).not.toBeInTheDocument();
  });

  it('기존 스테퍼(동적 행)의 그룹 pill·행 pill·현재 그룹 헤더를 치환한다', () => {
    renderStepper(true);

    // 그룹 pill(그룹0/그룹1) + 현재 그룹 헤더가 모두 "홍길동 그룹0" 텍스트를 렌더한다.
    expect(screen.getAllByText('홍길동 그룹0').length).toBeGreaterThan(0);
    expect(screen.getByText('홍길동 그룹1')).toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 그룹0')).not.toBeInTheDocument();

    // 행 pill — getRowShortLabel 이 substitutedLabel 을 그대로 반환(12자 이하라 안 잘림).
    // MobileRowCard 자체 헤더도 row.label 폴백을 치환하므로(mobile-row-card.tsx:193)
    // 같은 문구가 두 번 렌더된다 — 카드 쪽은 이미 올바른 동작이라 getAllByText 로 확인.
    expect(screen.getAllByText('홍길동 행0-0').length).toBeGreaterThan(0);
    expect(screen.queryByText('{{{인용}}} 행0-0')).not.toBeInTheDocument();
  });
});
