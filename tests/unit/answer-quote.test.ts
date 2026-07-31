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

  it('같은 이름을 쓴 두 질문의 문구를 하나로 합친다', () => {
    const a = radioQuestion();
    const b = radioQuestion();
    b.id = 'q2';
    b.order = 1;
    const out = collectAnswerQuotes([a, b], { q1: 'v1', q2: 'v2' }, {});
    expect(out).toEqual({ 마케팅유형: '디지털마케팅 전략과 오프라인 홍보' });
  });
});
