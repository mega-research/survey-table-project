/**
 * 다단계 선택(multiselect) 레벨 옵션 라벨의 응답 인용 치환 회귀 테스트.
 *
 * Task 7 fix round 1 — 리뷰가 정정한 사실: collectAnswerQuotes(answer-quote.ts:240-241)는
 * multiselect 를 이미 인용 소스로 수집한다. 소스로는 되는데 표시(치환 대상)에서는 빠지면
 * "어디선 되고 어디선 안 되네" 비대칭이 생기므로, 다단계 선택 옵션 라벨에도 동일하게 적용한다.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UserDefinedMultiLevelSelect } from '@/features/question-renderer/user-defined-multi-level-select';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { SelectLevel } from '@/types/survey';

describe('UserDefinedMultiLevelSelect — 레벨 옵션 라벨 인용 치환', () => {
  it('1단계 옵션 라벨의 인용 토큰을 치환한다', () => {
    const levels: SelectLevel[] = [
      {
        id: 'lv1',
        label: '지역',
        order: 0,
        options: [
          { id: 'o1', value: 'o1', label: '{{{이름}}}님 지역' },
          { id: 'o2', value: 'o2', label: '일반 지역' },
        ],
      },
    ];

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <UserDefinedMultiLevelSelect levels={levels} values={[]} onChange={vi.fn()} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByRole('option', { name: '홍길동님 지역' })).toBeInTheDocument();
  });
});
