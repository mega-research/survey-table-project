import { describe, expect, it } from 'vitest';
import { collectAnswerQuotes, joinQuoteParts } from '@/lib/survey/answer-quote';
import type { Question } from '@/types/survey';

const radioQuestion = (): Question =>
  ({
    id: 'q1',
    surveyId: 's1',
    type: 'radio',
    title: '수행 여부',
    required: false,
    order: 0,
    answerQuoteEnabled: true,
    answerQuoteName: '마케팅유형',
    options: [
      { id: 'o1', label: '디지털', value: 'v1', answerQuoteText: '디지털마케팅 전략' },
      { id: 'o2', label: '오프라인', value: 'v2', answerQuoteText: '오프라인 홍보' },
      { id: 'o3', label: '없음', value: 'v3' }, // 인용 문구 없음 → 수집 제외
      { id: 'o4', label: '기타', value: 'v4', allowTextInput: true, answerQuoteText: '{{입력}}마케팅 전략' },
    ],
  }) as unknown as Question;

describe('joinQuoteParts', () => {
  it('0개면 빈 문자열', () => {
    expect(joinQuoteParts([])).toBe('');
  });

  it('1개면 그대로', () => {
    expect(joinQuoteParts(['디지털마케팅 전략'])).toBe('디지털마케팅 전략');
  });

  it('2개면 와/과로 잇되 앞 문구의 받침으로 판정한다', () => {
    expect(joinQuoteParts(['전략', '홍보'])).toBe('전략과 홍보');
    expect(joinQuoteParts(['홍보', '전략'])).toBe('홍보와 전략');
  });

  it('한글이 아닌 글자로 끝나면 받침 없음으로 취급한다', () => {
    expect(joinQuoteParts(['AR/VR', '전략'])).toBe('AR/VR와 전략');
  });

  it('3개 이상은 쉼표로 나열한다', () => {
    expect(joinQuoteParts(['A', 'B', 'C'])).toBe('A, B, C');
  });
});

describe('collectAnswerQuotes - 옵션 경로', () => {
  it('선택된 옵션의 인용 문구만 모은다', () => {
    const out = collectAnswerQuotes([radioQuestion()], { q1: 'v1' }, {});
    expect(out).toEqual({ 마케팅유형: '디지털마케팅 전략' });
  });

  it('복수 선택은 옵션 정의 순서로 조립한다', () => {
    const q = radioQuestion();
    q.type = 'checkbox';
    // 응답자가 v2 를 먼저 골랐어도 정의 순서(v1 → v2)를 따른다
    const out = collectAnswerQuotes([q], { q1: ['v2', 'v1'] }, {});
    expect(out).toEqual({ 마케팅유형: '디지털마케팅 전략과 오프라인 홍보' });
  });

  it('인용 문구가 빈 옵션은 선택돼도 수집하지 않는다', () => {
    const out = collectAnswerQuotes([radioQuestion()], { q1: 'v3' }, {});
    expect(out).toEqual({ 마케팅유형: '' });
  });

  it('{{입력}} 을 옵션 텍스트 입력값으로 치환한다', () => {
    const out = collectAnswerQuotes(
      [radioQuestion()],
      { q1: 'v4' },
      { q1: { o4: 'AR/VR' } },
    );
    expect(out).toEqual({ 마케팅유형: 'AR/VR마케팅 전략' });
  });

  it('아무것도 안 고르면 빈 문자열', () => {
    const out = collectAnswerQuotes([radioQuestion()], {}, {});
    expect(out).toEqual({ 마케팅유형: '' });
  });

  it('토글이 꺼져 있으면 수집하지 않는다', () => {
    const q = radioQuestion();
    q.answerQuoteEnabled = false;
    expect(collectAnswerQuotes([q], { q1: 'v1' }, {})).toEqual({});
  });

  it('인용 이름이 비어 있으면 수집하지 않는다', () => {
    const q = radioQuestion();
    q.answerQuoteName = '  ';
    expect(collectAnswerQuotes([q], { q1: 'v1' }, {})).toEqual({});
  });

  it('{{입력}} 만 있는 문구에 입력값이 없으면 기여하지 않는다', () => {
    // 문구가 `{{입력}}마케팅 전략`(o4, 공유 fixture) 처럼 고정 텍스트를 동반하면
    // 입력값이 비어도 렌더 결과가 비지 않는다 — 이 케이스는 버그를 재현하지 못한다.
    // 버그는 문구가 `{{입력}}` 단독일 때만 렌더 결과가 빈 문자열이 되므로,
    // 공유 fixture 를 바꾸지 않고 이 테스트 안에서만 옵션을 새로 구성한다.
    const q = {
      id: 'q1',
      surveyId: 's1',
      type: 'checkbox',
      title: '수행 여부',
      required: false,
      order: 0,
      answerQuoteEnabled: true,
      answerQuoteName: '마케팅유형',
      options: [
        { id: 'o1', label: '기타', value: 'v1', allowTextInput: true, answerQuoteText: '{{입력}}' },
        { id: 'o2', label: '오프라인', value: 'v2', answerQuoteText: 'BBB' },
      ],
    } as unknown as Question;

    // v1 에 입력값 없이 선택 → 렌더 결과가 '' 이므로 기여하지 않아야 한다.
    const out = collectAnswerQuotes([q], { q1: ['v1', 'v2'] }, {});
    expect(out).toEqual({ 마케팅유형: 'BBB' });
  });

  it('같은 이름을 쓴 두 질문의 문구를 하나로 합친다', () => {
    const a = radioQuestion();
    const b = radioQuestion();
    b.id = 'q2';
    b.order = 1;
    const out = collectAnswerQuotes([a, b], { q1: 'v1', q2: 'v2' }, {});
    expect(out).toEqual({ 마케팅유형: '디지털마케팅 전략과 오프라인 홍보' });
  });
});
