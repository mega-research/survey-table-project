/**
 * Task 9 fix round 1 — QuestionTestBody 의 공지(notice) 콘텐츠 인용 치환 회귀 테스트.
 *
 * 리뷰가 지적한 두 번째 소비처: question-test-card.tsx 의 notice 케이스가 `attrs` 만 넘기고
 * `quotes` 는 넘기지 않아, 빌더 미리보기에서 공지 본문의 `{{{이름}}}` 토큰이 항상 빈칸으로만
 * 보였다. NoticeRenderer 자체는 sanitize(substitute(x)) 순서를 유지한다(sanitizeRichHtml 을
 * content prop 내부에서 적용).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QuestionTestBody } from '@/components/survey-builder/question-test-card';
import { ContactAttrsProvider, createPlaceholderAttrs } from '@/lib/survey/contact-attrs-context';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { Question } from '@/types/survey';

function noticeQuestion(templateName: string): Question {
  return {
    id: 'qn1',
    type: 'notice',
    title: '공지',
    required: false,
    order: 0,
    noticeContent: `<p>{{{${templateName}}}}님 안내</p>`,
  } as unknown as Question;
}

describe('QuestionTestBody — 공지 콘텐츠 인용 치환', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useTestResponseStore.getState().clearTestResponses();
  });

  afterEach(() => {
    cleanup();
  });

  it('quotes 에 이름이 빈 문자열이면 공지 본문이 빈칸으로 렌더된다', () => {
    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({ 이름: '' })}>
        <QuestionTestBody question={noticeQuestion('이름')} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('님 안내')).toBeInTheDocument();
  });

  it('quotes 에 문구가 있으면 공지 본문이 치환된다', () => {
    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({ 이름: '홍길동' })}>
        <QuestionTestBody question={noticeQuestion('이름')} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 안내')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{\{이름\}\}\}/)).not.toBeInTheDocument();
  });

  it('quotes 에 없는 이름을 참조하면 [이름] 으로 오타가 드러난다', () => {
    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({})}>
        <QuestionTestBody question={noticeQuestion('오타이름')} />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('[오타이름]님 안내')).toBeInTheDocument();
  });
});
