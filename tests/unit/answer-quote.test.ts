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

describe('collectAnswerQuotes - 나머지 경로', () => {
  it('다단계 선택은 문구가 적힌 단계만 인용한다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'multiselect', title: '지역',
      required: false, order: 0,
      answerQuoteEnabled: true, answerQuoteName: '지역',
      selectLevels: [
        { id: 'L1', label: '시도', options: [{ id: 'a', label: '서울', value: '서울' }] },
        { id: 'L2', label: '구군', options: [{ id: 'b', label: '강남구', value: '강남구', answerQuoteText: '강남구' }] },
      ],
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: ['서울', '강남구'] }, {}))
      .toEqual({ 지역: '강남구' });
  });

  it('순위형은 정의 순서가 아니라 순위 순으로 나열한다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'ranking', title: '우선순위',
      required: false, order: 0,
      answerQuoteEnabled: true, answerQuoteName: '우선순위',
      rankingConfig: { optionsSource: 'manual', maxRank: 2 },
      options: [
        { id: 'o1', label: '가격', value: 'v1', answerQuoteText: '가격' },
        { id: 'o2', label: '품질', value: 'v2', answerQuoteText: '품질' },
      ],
    } as unknown as Question;
    // 1위 v2(품질), 2위 v1(가격) → 정의 순서를 따르지 않는다
    const answers = [
      { rank: 1, optionValue: 'v2' },
      { rank: 2, optionValue: 'v1' },
    ];
    expect(collectAnswerQuotes([q], { q1: answers }, {}))
      .toEqual({ 우선순위: '품질과 가격' });
  });

  it('표 input 셀은 값이 있으면 수집하고 0도 값으로 본다', () => {
    // 셀 스코프 전환(task-1) 이후 표 input 셀의 인용 이름은 질문이 아니라 셀이 갖는다.
    const q = {
      id: 'q1', surveyId: 's1', type: 'table', title: '투입 인력',
      required: false, order: 0,
      tableRowsData: [
        { id: 'r1', cells: [
          { id: 'c1', type: 'input', answerQuoteEnabled: true, answerQuoteName: '인력',
            answerQuoteText: '{{입력}}명' },
          { id: 'c2', type: 'input', answerQuoteEnabled: true, answerQuoteName: '인력',
            answerQuoteText: '{{입력}}명' },
        ] },
      ],
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: { c1: '0', c2: '' } }, {}))
      .toEqual({ 인력: '0명' });
  });

  it('input 셀의 문구가 비면 입력값을 그대로 쓴다', () => {
    // 셀 스코프 전환(task-1) 이후 표 input 셀의 인용 이름은 질문이 아니라 셀이 갖는다.
    const q = {
      id: 'q1', surveyId: 's1', type: 'table', title: '기타',
      required: false, order: 0,
      tableRowsData: [{ id: 'r1', cells: [
        { id: 'c1', type: 'input', answerQuoteEnabled: true, answerQuoteName: '기타' },
      ] }],
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: { c1: 'AR/VR' } }, {}))
      .toEqual({ 기타: 'AR/VR' });
  });

  it('choice_opt 셀은 셀 경로에서 건너뛰어 이중 계산되지 않는다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'radio', title: '표 소스 라디오',
      required: false, order: 0,
      answerQuoteEnabled: true, answerQuoteName: '유형',
      options: [],
      tableRowsData: [
        { id: 'r1', cells: [
          { id: 'cellA', type: 'choice_opt', choiceLabel: '디지털', answerQuoteText: '디지털마케팅 전략' },
        ] },
      ],
    } as unknown as Question;
    // 응답값은 cell.id — 한 번만 잡혀야 한다
    expect(collectAnswerQuotes([q], { q1: 'cellA' }, {}))
      .toEqual({ 유형: '디지털마케팅 전략' });
  });

  it('단답형은 값이 있으면 수집한다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'text', title: '회사명',
      required: false, order: 0,
      answerQuoteEnabled: true, answerQuoteName: '회사명',
      answerQuoteText: '{{입력}} 귀하',
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: '메가리서치' }, {}))
      .toEqual({ 회사명: '메가리서치 귀하' });
    expect(collectAnswerQuotes([q], { q1: '' }, {}))
      .toEqual({ 회사명: '' });
  });

  it('장문형은 인용하지 않는다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'textarea', title: '의견',
      required: false, order: 0,
      answerQuoteEnabled: true, answerQuoteName: '의견',
      answerQuoteText: '{{입력}}',
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: '긴 서술' }, {}))
      .toEqual({ 의견: '' });
  });
});

describe('collectAnswerQuotes - 셀 단위 인용 이름', () => {
  const tableWithCellQuotes = () =>
    ({
      id: 'q1', surveyId: 's1', type: 'table', title: '마케팅 수행 현황',
      required: false, order: 0,
      tableRowsData: [
        { id: 'r1', cells: [
          { id: 'c1', type: 'radio', answerQuoteEnabled: true, answerQuoteName: '디지털',
            radioOptions: [
              { id: 'o1', label: '수행', value: 'v1', answerQuoteText: '디지털마케팅' },
              { id: 'o2', label: '미수행', value: 'v2' },
            ] },
        ] },
        { id: 'r2', cells: [
          { id: 'c2', type: 'radio', answerQuoteEnabled: true, answerQuoteName: '오프라인',
            radioOptions: [
              { id: 'o3', label: '수행', value: 'v3', answerQuoteText: '오프라인 홍보' },
            ] },
        ] },
      ],
    }) as unknown as Question;

  it('셀마다 자기 이름으로 따로 수집한다', () => {
    const out = collectAnswerQuotes([tableWithCellQuotes()], { q1: { c1: 'v1', c2: 'v3' } }, {});
    expect(out).toEqual({ 디지털: '디지털마케팅', 오프라인: '오프라인 홍보' });
  });

  it('여러 셀이 같은 이름을 쓰면 하나로 합친다', () => {
    const q = tableWithCellQuotes();
    q.tableRowsData![1]!.cells[0]!.answerQuoteName = '디지털';
    const out = collectAnswerQuotes([q], { q1: { c1: 'v1', c2: 'v3' } }, {});
    expect(out).toEqual({ 디지털: '디지털마케팅과 오프라인 홍보' });
  });

  it('셀 토글이 꺼져 있으면 수집하지 않는다', () => {
    const q = tableWithCellQuotes();
    q.tableRowsData![0]!.cells[0]!.answerQuoteEnabled = false;
    const out = collectAnswerQuotes([q], { q1: { c1: 'v1', c2: 'v3' } }, {});
    expect(out).toEqual({ 오프라인: '오프라인 홍보' });
  });

  it('셀 이름이 비어 있으면 수집하지 않는다', () => {
    const q = tableWithCellQuotes();
    q.tableRowsData![0]!.cells[0]!.answerQuoteName = '  ';
    const out = collectAnswerQuotes([q], { q1: { c1: 'v1' } }, {});
    // c2('오프라인')는 이름이 살아있는 채로 활성 상태라 응답이 없어도 빈 문자열로
    // 키가 생긴다(미응답 인용이 빌더의 [오타이름] 진단으로 오탐되지 않게 하는 설계).
    // 이 테스트가 검증하는 건 이름이 비워진 c1이 아예 수집되지 않는다는 것뿐이다.
    expect(out).toEqual({ 오프라인: '' });
  });

  it('표 질문의 질문 레벨 이름은 더 이상 쓰이지 않는다', () => {
    const q = tableWithCellQuotes();
    q.answerQuoteEnabled = true;
    q.answerQuoteName = '표전체';
    const out = collectAnswerQuotes([q], { q1: { c1: 'v1' } }, {});
    expect(out).not.toHaveProperty('표전체');
    // c2('오프라인')는 응답이 없어도 활성+이름 있는 셀이라 빈 문자열로 키가 생긴다.
    expect(out).toEqual({ 디지털: '디지털마케팅', 오프라인: '' });
  });

  it('input 셀도 자기 이름으로 수집한다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'table', title: '투입 인력',
      required: false, order: 0,
      tableRowsData: [{ id: 'r1', cells: [
        { id: 'c1', type: 'input', answerQuoteEnabled: true, answerQuoteName: '인력',
          answerQuoteText: '{{입력}}명' },
      ] }],
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: { c1: '3' } }, {})).toEqual({ 인력: '3명' });
  });

  it('표-소스 선택형 질문은 질문 레벨 이름을 계속 쓴다', () => {
    const q = {
      id: 'q1', surveyId: 's1', type: 'radio', title: '표 소스 라디오',
      required: false, order: 0,
      answerQuoteEnabled: true, answerQuoteName: '유형',
      options: [],
      tableRowsData: [{ id: 'r1', cells: [
        { id: 'cellA', type: 'choice_opt', choiceLabel: '디지털',
          answerQuoteText: '디지털마케팅 전략' },
      ] }],
    } as unknown as Question;
    expect(collectAnswerQuotes([q], { q1: 'cellA' }, {})).toEqual({ 유형: '디지털마케팅 전략' });
  });
});
