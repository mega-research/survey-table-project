import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question } from '@/types/survey';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

/**
 * 공지 본문은 서식본이라 편집기가 토큰 중괄호와 열 이름 사이에 태그를 끼울 수 있다.
 * 평문 치환을 쓰면 태그가 열 이름에 섞여 값이 빈칸이 된다(2026-11-03 예술기업 만족도 조사).
 */
describe('공지 본문 토큰 — 서식 태그가 낀 토큰도 명단 값으로 바꾼다', () => {
  afterEach(cleanup);

  it('중괄호와 열 이름이 다른 span 에 나뉘어 있어도 값이 들어간다', () => {
    const question = {
      id: 'q-notice',
      type: 'notice',
      title: '선정 이력 안내',
      required: false,
      order: 0,
      noticeContent:
        '<p><span><span style="font-size: 18px;">( {{</span></span>신청명(E나라도움)<span><span style="font-size: 18px;">}} )</span></span></p>',
    } as unknown as Question;
    const { container } = render(
      <ContactAttrsProvider attrs={{ '신청명(E나라도움)': '다이브인 아트스테이' }}>
        <QuestionInput question={question} value={undefined} onChange={() => {}} />
      </ContactAttrsProvider>,
    );
    expect(container.textContent).toContain('( 다이브인 아트스테이 )');
  });
});
