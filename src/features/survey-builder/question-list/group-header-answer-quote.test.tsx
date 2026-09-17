/**
 * Task 9 fix round 1 — GroupHeader 그룹 이름 인용 치환 회귀 테스트.
 *
 * 리뷰가 지적한 세 번째 소비처: 응답 페이지는 Task 7 에서 그룹 이름에 인용 치환을 적용했지만
 * 빌더의 GroupHeader 는 raw `group.name` 을 그대로 그렸다. 같은 비대칭을 한 단계 위에서
 * 재현하므로 빌더도 맞춘다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GroupHeader } from '@/features/survey-builder/question-list/group-header';
import { ContactAttrsProvider, createPlaceholderAttrs } from '@/features/question-renderer/contact-attrs-context';
import type { QuestionGroup } from '@/types/survey';

function group(templateName: string): QuestionGroup {
  return {
    id: 'g1',
    surveyId: 's1',
    name: `{{{${templateName}}}}님 그룹`,
    order: 0,
  };
}

describe('GroupHeader — 그룹 이름 인용 치환', () => {
  afterEach(() => {
    cleanup();
  });

  it('quotes 에 이름이 빈 문자열이면 그룹 이름이 빈칸으로 렌더된다', () => {
    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({ 이름: '' })}>
        <GroupHeader group={group('이름')} questionCount={1} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByRole('heading', { level: 3, name: '님 그룹' })).toBeInTheDocument();
  });

  it('quotes 에 문구가 있으면 그룹 이름이 치환된다', () => {
    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({ 이름: '홍길동' })}>
        <GroupHeader group={group('이름')} questionCount={1} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByRole('heading', { level: 3, name: '홍길동님 그룹' })).toBeInTheDocument();
  });

  it('quotes 에 없는 이름을 참조하면 [이름] 으로 오타가 드러난다', () => {
    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({})}>
        <GroupHeader group={group('오타이름')} questionCount={1} />
      </ContactAttrsProvider>,
    );

    expect(
      screen.getByRole('heading', { level: 3, name: '[오타이름]님 그룹' }),
    ).toBeInTheDocument();
  });
});
