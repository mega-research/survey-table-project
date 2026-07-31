import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TokenWarningPanel } from '@/components/survey-builder/token-warning-panel';
import type { Question, QuestionGroup } from '@/types/survey';

/**
 * 최소 필드만 채운 Question 팩토리. tests/unit/answer-quote.test.ts 와 동일한
 * `as unknown as Question` 캐스팅 관례를 따른다 — 타입 전체를 채우지 않아도
 * 컴포넌트가 실제로 읽는 필드만 있으면 충분하다.
 */
function q(overrides: Record<string, unknown>): Question {
  return {
    id: overrides['id'] ?? 'q',
    type: 'text',
    title: '',
    required: false,
    order: 0,
    ...overrides,
  } as unknown as Question;
}

describe('TokenWarningPanel - 경고 1: 정의되지 않은 인용 이름 참조', () => {
  it('참조하는 이름을 가진 질문이 없으면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[q({ id: 'q2', order: 1, title: '{{{없는이름}}} 관련 문의' })]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/정의되지 않은 인용 이름/)).toBeInTheDocument();
    expect(screen.getByText('{{{없는이름}}}')).toBeInTheDocument();
  });

  it('근접 케이스: 이름을 가진 질문이 앞에 있으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'radio',
            title: '마케팅 유형 선택',
            answerQuoteEnabled: true,
            answerQuoteName: '있는이름',
            options: [{ id: 'o1', label: 'A', value: 'v1', answerQuoteText: '문구' }],
          }),
          q({ id: 'q2', order: 2, title: '{{{있는이름}}} 관련 문의' }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/정의되지 않은 인용 이름/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 경고 2: 인용을 켰는데 문구가 전부 빈 질문', () => {
  it('옵션 문구가 모두 비어 있으면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'radio',
            title: '마케팅 유형 선택',
            answerQuoteEnabled: true,
            answerQuoteName: '마케팅유형',
            options: [
              { id: 'o1', label: 'A', value: 'v1' },
              { id: 'o2', label: 'B', value: 'v2', answerQuoteText: '   ' }, // 공백만 → 빈 것과 동일
            ],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/인용 문구가 모두 비어 있는 질문/)).toBeInTheDocument();
    expect(screen.getByText(/"마케팅 유형 선택" \(인용 이름: 마케팅유형\)/)).toBeInTheDocument();
  });

  it('근접 케이스: 옵션 하나라도 문구가 있으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'radio',
            title: '마케팅 유형 선택',
            answerQuoteEnabled: true,
            answerQuoteName: '마케팅유형',
            options: [
              { id: 'o1', label: 'A', value: 'v1' },
              { id: 'o2', label: 'B', value: 'v2', answerQuoteText: '실제 문구' },
            ],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/인용 문구가 모두 비어 있는 질문/)).not.toBeInTheDocument();
  });

  it('단답형은 질문 자체의 answerQuoteText 로 판정한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'text',
            title: '이름 입력',
            answerQuoteEnabled: true,
            answerQuoteName: '이름',
            // answerQuoteText 미지정 → 빈 문구
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/인용 문구가 모두 비어 있는 질문/)).toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 경고 3: 뒤를 참조하는 경우', () => {
  it('소비처가 출처보다 앞에 있으면(순서 위반) 최고 강도로 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({ id: 'consumer', order: 1, title: '{{{나이대}}}님께 안내드립니다' }),
          q({
            id: 'source',
            order: 2,
            type: 'radio',
            title: '나이대를 선택하세요',
            answerQuoteEnabled: true,
            answerQuoteName: '나이대',
            options: [{ id: 'o1', label: '20대', value: 'v1', answerQuoteText: '20대' }],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    const alert = screen.getByText(/뒤 질문의 응답을 인용하는 설정 오류/);
    expect(alert).toBeInTheDocument();
    // 강한 처리 확인 — 붉은 톤 alert 박스여야 한다
    const box = alert.closest('[role="alert"]');
    expect(box).not.toBeNull();
    expect(box?.className).toMatch(/border-red-300/);
    expect(screen.getByText(/나이대를 선택하세요/)).toBeInTheDocument();
  });

  it('근접 케이스: 소비처가 출처보다 뒤에 있으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'source',
            order: 1,
            type: 'radio',
            title: '나이대를 선택하세요',
            answerQuoteEnabled: true,
            answerQuoteName: '나이대',
            options: [{ id: 'o1', label: '20대', value: 'v1', answerQuoteText: '20대' }],
          }),
          q({ id: 'consumer', order: 2, title: '{{{나이대}}}님께 안내드립니다' }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/뒤 질문의 응답을 인용하는 설정 오류/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 경고 4: 치환되지 않는 자리에 쓴 인용 토큰', () => {
  it('완료 메시지에 인용 토큰이 있으면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[]}
        groups={[]}
        thankYouMessage="{{{이름}}}님, 감사합니다"
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{{이름}}} — 완료 메시지')).toBeInTheDocument();
  });

  it('근접 케이스: 완료 메시지에 토큰이 없으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[]}
        groups={[]}
        thankYouMessage="감사합니다"
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/치환되지 않는 자리에 쓴 인용 토큰/)).not.toBeInTheDocument();
  });

  it('표 헤더 그리드 라벨에 인용 토큰이 있으면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '만족도 표',
            tableHeaderGrid: [
              [{ id: 'h1', label: '{{{항목}}}', colspan: 1, rowspan: 1 }],
            ],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText(/표 헤더 그리드 \(만족도 표\)/)).toBeInTheDocument();
  });

  it('근접 케이스: 표 헤더 그리드 라벨에 토큰이 없으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '만족도 표',
            tableHeaderGrid: [[{ id: 'h1', label: '일반 라벨', colspan: 1, rowspan: 1 }]],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/치환되지 않는 자리에 쓴 인용 토큰/)).not.toBeInTheDocument();
  });

  it('합계 검증 오류 메시지에 인용 토큰이 있으면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '숫자 입력 표',
            sumConstraints: [
              { id: 's1', cellIds: ['c1'], operator: 'eq', target: 100, errorMessage: '{{{합계}}}가 맞지 않습니다' },
            ],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText(/검증 오류 메시지 \(숫자 입력 표\)/)).toBeInTheDocument();
  });

  it('근접 케이스: 합계 검증 오류 메시지에 토큰이 없으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '숫자 입력 표',
            sumConstraints: [
              { id: 's1', cellIds: ['c1'], operator: 'eq', target: 100, errorMessage: '합계가 맞지 않습니다' },
            ],
          }),
        ]}
        groups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/치환되지 않는 자리에 쓴 인용 토큰/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 기존 컨택 토큰 경고 (회귀)', () => {
  it('카탈로그에 없는 컨택 토큰은 여전히 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[q({ id: 'q1', order: 1, description: '{{모르는키}} 참고' })]}
        groups={[]}
        thankYouMessage=""
        catalog={[{ key: '아는키', label: '아는키', category: 'attrs' }] as never}
      />,
    );
    expect(screen.getByText(/컨택 컬럼에 없는 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{모르는키}}')).toBeInTheDocument();
  });

  it('아무 문제도 없으면 아무 것도 렌더하지 않는다', () => {
    const { container } = render(
      <TokenWarningPanel
        questions={[q({ id: 'q1', order: 1, title: '평범한 질문' })]}
        groups={[]}
        thankYouMessage="감사합니다"
        catalog={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('TokenWarningPanel - 그룹 이름도 참조 표면에 포함된다', () => {
  it('그룹 이름의 인용 토큰도 정의 여부를 검사한다', () => {
    const group: QuestionGroup = {
      id: 'g1',
      surveyId: 's1',
      name: '{{{없는그룹이름}}} 섹션',
      order: 0,
    } as unknown as QuestionGroup;
    render(
      <TokenWarningPanel
        questions={[q({ id: 'q1', order: 1, groupId: 'g1', title: '질문' })]}
        groups={[group]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/정의되지 않은 인용 이름/)).toBeInTheDocument();
    expect(screen.getByText('{{{없는그룹이름}}}')).toBeInTheDocument();
  });
});
