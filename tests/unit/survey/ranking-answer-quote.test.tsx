/**
 * 순위형(ranking) 질문의 응답 인용 치환 회귀 테스트.
 *
 * Task 7 fix round 1 — 리뷰가 지적한 소비처 누락: RankingQuestion 의 플랫 옵션 목록(opt.label)·
 * 그룹 헤딩(g.label)·내장 테이블 모바일 카드(opt?.label 체인), RankingDropdownStack 의 실제
 * 순위 선택 드롭다운 옵션(native/Radix 둘 다)에 인용 토큰 치환이 빠져 있었다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RankingDropdownStack } from '@/features/question-renderer/ranking-dropdown-stack';
import { RankingQuestion } from '@/features/question-renderer/ranking-question';
import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import type { Question, QuestionOption } from '@/types/survey';

// TablePreview 는 ResizeObserver 를 사용하므로 jsdom 에서 모킹 (그룹 헤딩 테스트가
// hasEmbeddedTable=true 경로를 타서 데스크탑 참조 테이블을 렌더하기 때문).
vi.mock('@/features/question-renderer/table-preview', () => ({
  TablePreview: () => null,
}));

let mobileFlag = false;
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => mobileFlag,
  useMediaQuery: () => mobileFlag,
}));

describe('RankingQuestion — 플랫(manual) 옵션 목록 인용 치환', () => {
  it('optionsSource=manual, 내장 테이블 없음 → 목록 라벨의 인용 토큰을 치환한다', () => {
    mobileFlag = false;
    const question: Question = {
      id: 'q1',
      type: 'ranking',
      title: '순위형',
      required: false,
      order: 0,
      rankingConfig: { optionsSource: 'manual', positions: 2 },
      options: [
        { id: 'o1', value: 'o1', label: '{{{이름}}}님 선택지' },
        { id: 'o2', value: 'o2', label: '일반 선택지' },
      ],
    } as unknown as Question;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <RankingQuestion question={question} value={null} onChange={vi.fn()} />
      </ContactAttrsProvider>,
    );

    // 목록(설명 텍스트)과 드롭다운 옵션 두 자리에 동일 라벨이 나타난다 — 최소 1곳 이상 확인
    expect(screen.getAllByText('홍길동님 선택지').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('{{{이름}}}님 선택지')).not.toBeInTheDocument();
  });
});

describe('RankingQuestion — 그룹 헤딩 인용 치환', () => {
  function groupedFixtureWithQuoteLabel(): Question {
    return {
      id: 'qg1',
      type: 'ranking',
      title: '순위형 그룹',
      required: false,
      order: 0,
      rankingConfig: { optionsSource: 'table', positions: 2 },
      tableColumns: [{ id: 'c1', label: '열' }],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            {
              id: 'cellA',
              type: 'ranking_opt',
              content: '항목A',
              rankingLabel: '항목A',
              choiceGroupId: 'grp1',
            },
          ],
        },
      ],
      choiceGroups: [
        { id: 'grp1', type: 'ranking', groupKey: 'grp1key', label: '{{{이름}}}님 그룹' },
      ],
    } as unknown as Question;
  }

  it('그룹 헤딩(g.label)의 인용 토큰을 치환한다', () => {
    mobileFlag = false;
    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <RankingQuestion question={groupedFixtureWithQuoteLabel()} value={null} onChange={vi.fn()} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 그룹')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 그룹')).not.toBeInTheDocument();
  });
});

describe('RankingQuestion — 내장 테이블 모바일 카드 인용 치환', () => {
  it('모바일 카드 라벨(opt?.label 체인)의 인용 토큰을 치환한다', () => {
    mobileFlag = true;
    const question: Question = {
      id: 'qm1',
      type: 'ranking',
      title: '순위형 모바일',
      required: false,
      order: 0,
      rankingConfig: { optionsSource: 'table', positions: 1 },
      tableColumns: [{ id: 'c1', label: '열' }],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            { id: 'cellA', type: 'ranking_opt', content: '{{{이름}}}님 항목' },
          ],
        },
      ],
    } as unknown as Question;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <RankingQuestion question={question} value={null} onChange={vi.fn()} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 항목')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 항목')).not.toBeInTheDocument();
    mobileFlag = false;
  });
});

describe('RankingDropdownStack — 순위 선택 드롭다운 옵션 인용 치환', () => {
  const options: QuestionOption[] = [
    { id: 'o1', value: 'o1', label: '{{{이름}}}님 옵션' },
    { id: 'o2', value: 'o2', label: '일반 옵션' },
  ];

  it('compact(native select) 옵션의 인용 토큰을 치환한다', () => {
    mobileFlag = false;
    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <RankingDropdownStack
          answers={[]}
          options={options}
          positions={1}
          allowDuplicates={false}
          allowOther={false}
          onChange={vi.fn()}
          compact
        />
      </ContactAttrsProvider>,
    );

    expect(screen.getByRole('option', { name: '홍길동님 옵션' })).toBeInTheDocument();
  });

  it('Radix Select 옵션의 인용 토큰을 치환한다', () => {
    mobileFlag = false;
    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <RankingDropdownStack
          answers={[]}
          options={options}
          positions={1}
          allowDuplicates={false}
          allowOther={false}
          onChange={vi.fn()}
        />
      </ContactAttrsProvider>,
    );

    const trigger = screen.getByRole('combobox', { name: '1순위 선택' });
    fireEvent.click(trigger);

    expect(screen.getByRole('option', { name: '홍길동님 옵션' })).toBeInTheDocument();
  });
});
