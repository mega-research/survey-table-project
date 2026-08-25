import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TokenWarningPanel } from '@/features/survey-builder/token-warning-panel';
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/인용 문구가 모두 비어 있는 질문/)).not.toBeInTheDocument();
  });

  it('단답형은 문구가 비어도 원본 입력값을 그대로 인용하므로 경고하지 않는다', () => {
    // renderQuoteCandidate 의 mode:'input' 계약(answer-quote.ts) — 빈 템플릿은 "항상 빈
    // 문자열"이 아니라 응답자가 입력한 원본 값을 그대로 쓴다는 뜻이다.
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
            // answerQuoteText 미지정 → 빈 문구이지만 원본 입력값을 인용한다
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/인용 문구가 모두 비어 있는 질문/)).not.toBeInTheDocument();
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
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
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/정의되지 않은 인용 이름/)).toBeInTheDocument();
    expect(screen.getByText('{{{없는그룹이름}}}')).toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 최종 리뷰 I2: 표 셀 defaultValueTemplate 은 치환되지 않는 자리다', () => {
  // prefill 결과는 응답으로 저장되는 값이라 인용 채널을 붙이지 않는다(cells/input-cell.tsx).
  // 질문 레벨 prefill 과 동일 규칙 — 참조 표면이 아니라 경고 4의 대상이다.
  it('표 셀 prefill 템플릿에 인용 토큰이 있으면 경고 4가 뜬다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    defaultValueTemplate: '{{{이름}}}',
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{{이름}}} — 표 셀 prefill 템플릿 (표 질문)')).toBeInTheDocument();
  });

  it('앞 질문이 그 이름을 정의하고 있어도 여전히 경고 4가 뜬다', () => {
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
          q({
            id: 'q2',
            order: 2,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    defaultValueTemplate: '{{{나이대}}}',
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{{나이대}}} — 표 셀 prefill 템플릿 (표 질문)')).toBeInTheDocument();
  });

  it('참조 표면이 아니므로 뒤 질문을 가리켜도 순서 위반 경고는 뜨지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'consumer',
            order: 1,
            type: 'table',
            title: '표 질문(소비처)',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    defaultValueTemplate: '{{{나이대}}}',
                  },
                ],
              },
            ],
          }),
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
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/뒤 질문의 응답을 인용하는 설정 오류/)).not.toBeInTheDocument();
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
  });

  it('근접 케이스: 컨택 attrs 토큰만 쓰면 경고 4가 뜨지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    defaultValueTemplate: '{{이름}}',
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[{ key: '이름', label: '이름', category: 'attrs' }] as never}
      />,
    );
    expect(screen.queryByText(/치환되지 않는 자리에 쓴 인용 토큰/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 최종 리뷰 I3: 표 제목과 열 제목도 치환되지 않는 자리다', () => {
  it('tableHeaderGrid 없이 tableColumns 라벨에 인용 토큰이 있으면 경고 4가 뜬다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '만족도 표',
            tableColumns: [
              { id: 'col1', label: '{{{항목}}} 만족도', width: 100 },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{{항목}}} — 표 열 제목 (만족도 표)')).toBeInTheDocument();
  });

  it('표 제목(tableTitle)에 인용 토큰이 있으면 경고 4가 뜬다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '만족도 표',
            tableTitle: '{{{브랜드}}} 만족도',
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{{브랜드}}} — 표 제목 (만족도 표)')).toBeInTheDocument();
  });

  it('근접 케이스: 열 제목·표 제목에 토큰이 없으면 경고 4가 뜨지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '만족도 표',
            tableTitle: '만족도',
            tableColumns: [{ id: 'col1', label: '점수', width: 100 }],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/치환되지 않는 자리에 쓴 인용 토큰/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - 질문 레벨 defaultValueTemplate 은 치환되지 않는 자리다', () => {
  it('단답형 prefill 템플릿에 인용 토큰이 있으면 경고 4가 뜬다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'text',
            title: '이름 입력',
            defaultValueTemplate: '{{{이름}}}',
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/치환되지 않는 자리에 쓴 인용 토큰/)).toBeInTheDocument();
    expect(screen.getByText('{{{이름}}} — 단답형 prefill 템플릿 (이름 입력)')).toBeInTheDocument();
  });

  it('근접 케이스: 단답형 prefill 템플릿에 토큰이 없으면 경고 4가 뜨지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'text',
            title: '이름 입력',
            defaultValueTemplate: '{{성}} {{이름}}', // 컨택 attrs 토큰 — 인용 채널과 무관
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/치환되지 않는 자리에 쓴 인용 토큰/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - Task 3: 셀 단위 인용 이름도 정의로 인정한다 (경고 1)', () => {
  it('셀에 정의한 인용 이름을 올바르게 참조하면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '응답값',
                    answerQuoteText: '테스트 문구',
                  },
                ],
              },
            ],
          }),
          q({ id: 'q2', order: 2, title: '{{{응답값}}} 님 감사합니다' }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/정의되지 않은 인용 이름/)).not.toBeInTheDocument();
  });

  it('근접 케이스: 셀 인용 이름을 오타로 참조하면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '응답값',
                    answerQuoteText: '테스트 문구',
                  },
                ],
              },
            ],
          }),
          q({ id: 'q2', order: 2, title: '{{{응답갑}}} 님 감사합니다' }), // 오타: 값 → 갑
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/정의되지 않은 인용 이름/)).toBeInTheDocument();
    expect(screen.getByText('{{{응답갑}}}')).toBeInTheDocument();
  });

  it('표 질문의 질문 레벨 인용(레거시)은 더 이상 정의로 인정하지 않는다 — 참조는 여전히 경고한다', () => {
    // Task 2 이후 표 질문에서는 이 토글이 UI 에서 사라졌지만, 레거시 데이터에는 남아있을 수
    // 있다. 수집기(answer-quote.ts:213)가 표 질문의 질문 레벨 경로를 애초에 안 보므로,
    // 이 이름을 정의로 인정하면 실제로는 항상 빈 문자열인 참조를 "정의됨"으로 오판한다.
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '레거시 표',
            answerQuoteEnabled: true,
            answerQuoteName: '레거시이름',
          }),
          q({ id: 'q2', order: 2, title: '{{{레거시이름}}} 안내' }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/정의되지 않은 인용 이름/)).toBeInTheDocument();
    expect(screen.getByText('{{{레거시이름}}}')).toBeInTheDocument();
  });

  it('근접 케이스: 표가 아닌 질문의 질문 레벨 인용은 그대로 정의로 인정한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'radio',
            title: '나이대를 선택하세요',
            answerQuoteEnabled: true,
            answerQuoteName: '나이대',
            options: [{ id: 'o1', label: '20대', value: 'v1', answerQuoteText: '20대' }],
          }),
          q({ id: 'q2', order: 2, title: '{{{나이대}}} 님 감사합니다' }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/정의되지 않은 인용 이름/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - Task 3: 셀 인용 문구가 전부 비면 경고한다 (경고 2)', () => {
  it('셀 인용을 켰는데 옵션 문구가 모두 비어 있으면 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'radio',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '유형',
                    radioOptions: [{ id: 'o1', label: 'A', value: 'v1' }],
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/인용 문구가 모두 비어 있는 질문/)).toBeInTheDocument();
    expect(screen.getByText(/표 질문.*\(인용 이름: 유형\)/)).toBeInTheDocument();
  });

  it('근접 케이스: 셀 옵션에 문구가 있으면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'radio',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '유형',
                    radioOptions: [{ id: 'o1', label: 'A', value: 'v1', answerQuoteText: '문구' }],
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/인용 문구가 모두 비어 있는 질문/)).not.toBeInTheDocument();
  });

  it('근접 케이스: 같은 표 안 다른 셀에 문구가 있어도 이 셀 자신이 비어 있으면 경고한다', () => {
    // 셀은 자기 이름으로 독립 정의된다 — 표 전체를 훑어 "어딘가에 문구가 있다"로 판정하면
    // 안 된다. 표-레벨 판정으로 되돌아가면 이 테스트가 깨진다.
    // radio 사용 이유: input 셀은 빈 문구가 "원본 입력값 인용"이라 항상 유효해 이 판정
    // 자체가 성립하지 않는다(경고 2 수정 참조) — 옵션 문구를 쓰는 radio 로 판정한다.
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'radio',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '빈셀',
                    radioOptions: [{ id: 'o1', label: 'A', value: 'v1' }],
                    // 옵션 answerQuoteText 없음 → 빈 인용
                  },
                  {
                    id: 'c2',
                    type: 'radio',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '채운셀',
                    radioOptions: [{ id: 'o1', label: 'A', value: 'v1', answerQuoteText: '문구 있음' }],
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/인용 문구가 모두 비어 있는 질문/)).toBeInTheDocument();
    expect(screen.getByText(/\(인용 이름: 빈셀\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(인용 이름: 채운셀\)/)).not.toBeInTheDocument();
  });

  it('input 셀은 문구가 비어도 원본 입력값을 인용하므로 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '인력',
                    // answerQuoteText 없음 → 원본 입력값을 그대로 인용
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/인용 문구가 모두 비어 있는 질문/)).not.toBeInTheDocument();
  });
});

describe('TokenWarningPanel - Task 3: 셀 출처는 호스트 질문의 order 로 순서를 판정한다 (경고 3)', () => {
  it('표보다 앞의 질문이 셀 인용 이름을 참조하면(순서 위반) 경고한다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({ id: 'consumer', order: 1, title: '{{{유형}}} 안내' }),
          q({
            id: 'source',
            order: 2,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '유형',
                    answerQuoteText: '문구',
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/뒤 질문의 응답을 인용하는 설정 오류/)).toBeInTheDocument();
  });

  it('근접 케이스: 표보다 뒤의 질문이 셀 인용 이름을 참조하면 경고하지 않는다', () => {
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'source',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '유형',
                    answerQuoteText: '문구',
                  },
                ],
              },
            ],
          }),
          q({ id: 'consumer', order: 2, title: '{{{유형}}} 안내' }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/뒤 질문의 응답을 인용하는 설정 오류/)).not.toBeInTheDocument();
  });

  it('근접 케이스: 같은 표 안 다른 셀에서의 참조는 순서 위반으로 판정하지 않는다', () => {
    // 표는 한 화면에 다 나오고 응답 순서가 정해져 있지 않다 — 셀은 호스트 질문의 order 를
    // 공유하므로, 같은 표 안 참조까지 판정하면 정상적인 셀 간 참조도 전부 오탐이 된다.
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '표 질문',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '유형',
                    answerQuoteText: '문구',
                  },
                  { id: 'c2', type: 'text', content: '{{{유형}}} 참고' },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.queryByText(/뒤 질문의 응답을 인용하는 설정 오류/)).not.toBeInTheDocument();
    expect(screen.queryByText(/정의되지 않은 인용 이름/)).not.toBeInTheDocument();
  });

  it('표 자신의 제목이 자기 표의 셀 이름을 참조하면 경고한다(셀끼리 비교가 아니다)', () => {
    // 이 케이스는 셀-대-셀 비교가 아니다 — 표의 title 은 응답 페이지에서 그 표의 어떤 셀보다
    // 먼저 렌더되므로, 자기 표 셀의 인용을 참조하면 질문 레벨 자기참조와 동형으로 항상 빈
    // 문자열이다. "같은 표 안 셀끼리는 순서 비교 불가" 예외가 questionId 만으로 걸리면 이
    // 케이스까지 삼켜 오탐(false OK)이 되므로, fromCell 로 셀-셀 조합만 좁혀야 한다.
    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'q1',
            order: 1,
            type: 'table',
            title: '{{{유형}}} 표',
            tableRowsData: [
              {
                id: 'r1',
                label: '행1',
                cells: [
                  {
                    id: 'c1',
                    type: 'input',
                    content: '',
                    answerQuoteEnabled: true,
                    answerQuoteName: '유형',
                    answerQuoteText: '문구',
                  },
                ],
              },
            ],
          }),
        ]}
        groups={[]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );
    expect(screen.getByText(/뒤 질문의 응답을 인용하는 설정 오류/)).toBeInTheDocument();
  });
});

describe('TokenWarningPanel - Fix round 1: 그룹의 유효 order 는 하위 그룹까지 재귀해야 한다', () => {
  it('직계 질문이 없는 부모 그룹도 하위 그룹의 질문까지 내려가 순서 위반을 잡는다', () => {
    // 리뷰가 제시한 실제 구조: 부모 그룹은 직계 질문이 0개이고, 그 이름이 곧 인용 참조다.
    // 인용을 정의하는 질문은 하위 그룹 안에만 있다 — 직계 자식만 보면(수정 전) 부모의
    // 유효 order 가 null 이 되어 순서 위반 검사 자체가 스킵된다.
    const parentGroup: QuestionGroup = {
      id: 'gParent',
      surveyId: 's1',
      name: '{{{나이}}} 섹션',
      order: 0,
    } as unknown as QuestionGroup;
    const childGroup: QuestionGroup = {
      id: 'gChild',
      surveyId: 's1',
      name: '하위',
      order: 0,
      parentGroupId: 'gParent',
    } as unknown as QuestionGroup;

    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'source',
            order: 2,
            groupId: 'gChild',
            type: 'radio',
            title: '나이를 입력하세요',
            answerQuoteEnabled: true,
            answerQuoteName: '나이',
            options: [{ id: 'o1', label: '20대', value: 'v1', answerQuoteText: '20대' }],
          }),
        ]}
        groups={[parentGroup, childGroup]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );

    expect(screen.getByText(/뒤 질문의 응답을 인용하는 설정 오류/)).toBeInTheDocument();
  });

  it('근접 케이스: 같은 깊은 계층에서도 출처가 실제로 앞이면 순서 위반이 없다', () => {
    // gParent2 도 직계 질문이 0개다(재귀 없이는 유효 order 를 못 구함) — 하지만 소속
    // 질문(order=2)보다 앞선(order=1) 별도의 출처 질문이 이름을 정의하므로 위반이 아니다.
    const parentGroup2: QuestionGroup = {
      id: 'gParent2',
      surveyId: 's1',
      name: '{{{성별}}} 섹션',
      order: 1,
    } as unknown as QuestionGroup;
    const childGroup2: QuestionGroup = {
      id: 'gChild2',
      surveyId: 's1',
      name: '하위2',
      order: 0,
      parentGroupId: 'gParent2',
    } as unknown as QuestionGroup;

    render(
      <TokenWarningPanel
        questions={[
          q({
            id: 'earlySource',
            order: 1,
            type: 'radio',
            title: '성별을 선택하세요',
            answerQuoteEnabled: true,
            answerQuoteName: '성별',
            options: [{ id: 'o1', label: '여성', value: 'v1', answerQuoteText: '여성' }],
          }),
          q({ id: 'inChild', order: 2, groupId: 'gChild2', title: '하위 그룹 질문' }),
        ]}
        groups={[parentGroup2, childGroup2]}
        lookups={[]}
        thankYouMessage=""
        catalog={[]}
      />,
    );

    expect(screen.queryByText(/뒤 질문의 응답을 인용하는 설정 오류/)).not.toBeInTheDocument();
    expect(screen.queryByText(/정의되지 않은 인용 이름/)).not.toBeInTheDocument();
  });

  it('순환 parentGroupId 가 있어도 무한루프 없이 렌더된다(방어 가드)', () => {
    const cycleA: QuestionGroup = {
      id: 'gA',
      surveyId: 's1',
      name: '{{{순환}}} A',
      order: 0,
      parentGroupId: 'gB',
    } as unknown as QuestionGroup;
    const cycleB: QuestionGroup = {
      id: 'gB',
      surveyId: 's1',
      name: 'B',
      order: 0,
      parentGroupId: 'gA',
    } as unknown as QuestionGroup;

    expect(() =>
      render(
        <TokenWarningPanel
          questions={[q({ id: 'q1', order: 1, groupId: 'gA', title: '질문' })]}
          groups={[cycleA, cycleB]}
          lookups={[]}
          thankYouMessage=""
          catalog={[]}
        />,
      ),
    ).not.toThrow();
    // 순환 자체는 경고 대상이 아니다 — 이름 '순환'을 정의한 질문이 없으니 "정의되지 않은
    // 인용 이름"만 뜨면 되고(무한루프로 멈추지만 않으면 충분).
    expect(screen.getByText(/정의되지 않은 인용 이름/)).toBeInTheDocument();
  });
});
