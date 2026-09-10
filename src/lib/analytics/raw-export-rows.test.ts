import { describe, expect, it } from 'vitest';

import {
  type NonRespondentTarget,
  buildNonRespondentRow,
  mergePriorAnswersIntoResponses,
  mergePriorAnswersIntoRows,
  omitDisabledPriorAnswersByContact,
  sortRowsForContactPopulation,
  stripHiddenFromExportRows,
} from '@/lib/analytics/raw-export-rows';
import type { RawExportResponseRow } from '@/lib/analytics/raw-workbook';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles';
import type { Question } from '@/types/survey';

// 조사 대상 4명(resid 1~4) 중 2·4 만 응답했고 1·3 은 미응답. 익명 응답 2건은 시스템ID 가 없다.
const t1: NonRespondentTarget = { id: 't1', resid: 1, inviteCode: 'c1' };
const t3: NonRespondentTarget = { id: 't3', resid: 3, inviteCode: 'c3' };

function response(over: Partial<RawExportResponseRow> & Pick<RawExportResponseRow, 'id'>): RawExportResponseRow {
  return {
    questionResponses: { q1: 'opt1' },
    resid: null,
    inviteCode: null,
    ipHash: 'hash',
    currentStepId: null,
    platform: 'desktop',
    browser: 'Chrome',
    status: 'completed',
    startedAt: new Date('2026-09-01T09:00:00Z'),
    completedAt: null,
    totalSeconds: 60,
    ...over,
  };
}

const r1 = response({ id: 'r1', resid: 2, inviteCode: 'c2', startedAt: new Date('2026-09-01T09:00:00Z') });
const r2 = response({
  id: 'r2',
  resid: 4,
  inviteCode: 'c4',
  status: 'in_progress',
  startedAt: new Date('2026-09-01T09:05:00Z'),
});
const r3 = response({ id: 'r3', startedAt: new Date('2026-09-01T09:02:00Z') });
const r4 = response({ id: 'r4', startedAt: new Date('2026-09-01T09:01:00Z') });

describe('buildNonRespondentRow', () => {
  it('조사 대상 값만 채우고 응답 메타는 전부 null, 문항 응답은 빈 객체다', () => {
    const row = buildNonRespondentRow(t1);
    expect(row).toEqual({
      id: 't1',
      questionResponses: {},
      resid: 1,
      inviteCode: 'c1',
      ipHash: null,
      currentStepId: null,
      platform: null,
      browser: null,
      status: NOT_RESPONDED_STATUS,
      startedAt: null,
      completedAt: null,
      totalSeconds: null,
    });
  });
});

describe('sortRowsForContactPopulation', () => {
  it('시스템ID 오름차순, 익명 응답은 뒤에 시작일시 오름차순으로 놓는다', () => {
    const nr1 = buildNonRespondentRow(t1);
    const nr3 = buildNonRespondentRow(t3);
    const input = [r1, r2, r3, r4, nr1, nr3];
    const sorted = sortRowsForContactPopulation(input);
    expect(sorted.map((r) => r.id)).toEqual(['t1', 'r1', 't3', 'r2', 'r4', 'r3']);
  });

  it('입력 배열은 건드리지 않는다', () => {
    const input = [r2, r1, buildNonRespondentRow(t1)];
    const snapshot = [...input];
    sortRowsForContactPopulation(input);
    expect(input).toEqual(snapshot);
  });

  it('같은 시스템ID 응답이 여럿이면 시작일시 오름차순이다', () => {
    const later = response({ id: 'later', resid: 2, startedAt: new Date('2026-09-01T10:00:00Z') });
    const earlier = response({ id: 'earlier', resid: 2, startedAt: new Date('2026-09-01T08:00:00Z') });
    const sorted = sortRowsForContactPopulation([later, r1, earlier]);
    expect(sorted.map((r) => r.id)).toEqual(['earlier', 'r1', 'later']);
  });
});

// ============================================================
// 숨은 문항 값 걸러내기 — 제출도 어드민 수정도 안 거친 행이 rawdata 로 나갈 때
// ============================================================

/** 스위치 문항 + 그 값이 'yes' 일 때만 보이는 하류 문항. */
function switchFixture(): Question[] {
  return [
    { id: 'q-switch', type: 'radio', title: '스위치', required: false, order: 0 },
    {
      id: 'q-dep',
      type: 'text',
      title: '스위치가 켜져야 보이는 문항',
      required: false,
      order: 1,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: 'q-switch',
            requiredValues: ['yes'],
          },
        ],
      },
    },
  ];
}

describe('stripHiddenFromExportRows', () => {
  it('컨텍스트가 주어진 행에서 숨은 문항 값을 뺀다', () => {
    const row = response({
      id: 'r-hidden',
      status: 'in_progress',
      questionResponses: { 'q-switch': 'no', 'q-dep': '숨은 뒤에도 남아 있던 값' },
    });

    const [out] = stripHiddenFromExportRows(
      [row],
      new Map([['r-hidden', { questions: switchFixture() }]]),
    );

    expect(out?.questionResponses).toEqual({ 'q-switch': 'no' });
  });

  it('컨텍스트가 없는 행은 원본 객체 그대로 통과시킨다', () => {
    const row = response({
      id: 'r-done',
      questionResponses: { 'q-switch': 'no', 'q-dep': '완료본이라 손대면 안 되는 값' },
    });

    const [out] = stripHiddenFromExportRows([row], new Map());

    expect(out).toBe(row);
  });

  it('조건이 컨택 attrs 를 보면 그 attrs 로 판정한다', () => {
    const questions: Question[] = [
      {
        id: 'q-dep',
        type: 'text',
        title: '본조사 참여자에게만 보이는 문항',
        required: false,
        order: 0,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c1',
              enabled: true,
              logicType: 'AND',
              conditionType: 'expression',
              sourceQuestionId: 'q-dep',
              expressionConfig: {
                clauses: [
                  {
                    kind: 'comparison',
                    comparison: {
                      op: '==',
                      left: { kind: 'attr', attrsKey: '25년 조사 방법' },
                      right: { kind: 'literal', value: '본조사' },
                    },
                  },
                ],
                joinOps: [],
              },
            },
          ],
        },
      },
    ];
    const row = response({
      id: 'r-secondary',
      status: 'in_progress',
      questionResponses: { 'q-dep': '2차 자료 대상자에게 남은 값' },
    });

    const [out] = stripHiddenFromExportRows(
      [row],
      new Map([
        ['r-secondary', { questions, contactAttrs: { '25년 조사 방법': '2차 자료' } }],
      ]),
    );

    expect(out?.questionResponses).toEqual({});
  });

  it('컨트롤러가 미충족인 비활성 셀 값도 함께 뺀다', () => {
    // 게이팅 컨트롤러(c-ctrl)가 'yes' 일 때만 c-gated 가 활성. 컨트롤러가 'no' 로 바뀐 뒤
    // 남은 c-gated 값은 초안 저장이 게이팅 strip 을 안 걸어 DB 에 살아 있다.
    const questions: Question[] = [
      {
        id: 'q-table',
        type: 'table',
        title: '게이팅 표',
        required: false,
        order: 0,
        tableColumns: [{ id: 'col1', label: '값' }],
        tableRowsData: [
          {
            id: 'r1',
            label: '',
            cells: [
              { id: 'c-ctrl', type: 'radio', content: '' },
              {
                id: 'c-gated',
                type: 'input',
                content: '',
                enabledWhen: { kind: 'option', controllerCellId: 'c-ctrl', values: ['yes'] },
              },
            ],
          },
        ],
      },
    ];
    const row = response({
      id: 'r-gated',
      status: 'in_progress',
      questionResponses: { 'q-table': { 'c-ctrl': 'no', 'c-gated': '비활성인데 남은 값' } },
    });

    const [out] = stripHiddenFromExportRows([row], new Map([['r-gated', { questions }]]));

    expect(out?.questionResponses).toEqual({ 'q-table': { 'c-ctrl': 'no' } });
  });

  it('입력 배열과 행 객체를 변형하지 않는다', () => {
    const row = response({
      id: 'r-hidden',
      status: 'in_progress',
      questionResponses: { 'q-switch': 'no', 'q-dep': '값' },
    });
    const input = [row];

    stripHiddenFromExportRows(input, new Map([['r-hidden', { questions: switchFixture() }]]));

    expect(input).toEqual([row]);
    expect(row.questionResponses).toEqual({ 'q-switch': 'no', 'q-dep': '값' });
  });
});

describe('mergePriorAnswersIntoResponses — 「이월 응답 포함」', () => {
  it('이번 회차에 키가 없는 문항만 이월값으로 채운다', () => {
    const merged = mergePriorAnswersIntoResponses(
      { q1: 'new' },
      { q1: 'old', q2: 'old2', q3: ['a', 'b'] },
    );
    expect(merged).toEqual({ q1: 'new', q2: 'old2', q3: ['a', 'b'] });
  });

  it('응답자가 비운 값도 이번 회차 답이다 — 이월로 되살리지 않는다', () => {
    const merged = mergePriorAnswersIntoResponses({ q1: '', q2: [] }, { q1: 'old', q2: ['x'] });
    expect(merged).toEqual({ q1: '', q2: [] });
  });

  it('__optTexts__ 는 문항 단위로 같은 규칙이다', () => {
    const merged = mergePriorAnswersIntoResponses(
      { q1: 'a', __optTexts__: { q1: { o9: '이번 기타' } } },
      { q2: 'b', __optTexts__: { q1: { o9: '지난 기타' }, q2: { o5: '지난 상세' } } },
    );
    expect(merged['__optTexts__']).toEqual({ q1: { o9: '이번 기타' }, q2: { o5: '지난 상세' } });
  });

  it('변동 확인 같은 다른 사이드카는 이월에서 가져오지 않는다', () => {
    const merged = mergePriorAnswersIntoResponses({}, { q1: 'old', __changeConfirm__: { q1: 'same' } });
    expect(merged).toEqual({ q1: 'old' });
  });

  it('채울 것이 없으면 원본 객체 그대로 돌려준다', () => {
    const current = { q1: 'a' };
    expect(mergePriorAnswersIntoResponses(current, { q1: 'old' })).toBe(current);
    expect(mergePriorAnswersIntoResponses(current, undefined)).toBe(current);
  });

  it('행 목록에서는 조사 대상이 붙은 행만 합치고 나머지는 원본 그대로다', () => {
    const anon = response({ id: 'r-anon', questionResponses: { q1: 'x' } });
    const linked = response({ id: 'r-linked', questionResponses: { q1: 'x' } });
    const prior = new Map([['t-linked', { q1: 'old', q2: 'old2' }]]);
    const out = mergePriorAnswersIntoRows([anon, linked], prior, (row) =>
      row.id === 'r-linked' ? 't-linked' : null,
    );
    expect(out[0]).toBe(anon);
    expect(out[1]?.questionResponses).toEqual({ q1: 'x', q2: 'old2' });
    // 미응답 행(빈 응답)은 이월값이 통째로 실린다
    const blank = buildNonRespondentRow(t1);
    expect(mergePriorAnswersIntoResponses(blank.questionResponses, { q1: 'old' })).toEqual({ q1: 'old' });
  });
});

describe('omitDisabledPriorAnswersByContact — 「이월값 불러오기」 스위치', () => {
  const questions = [
    { id: 'q1', type: 'text', title: 'Q1', required: false, order: 0 },
    { id: 'q2', type: 'text', title: 'Q2', required: false, order: 1, priorAnswerDisabled: true },
    { id: 'q3', type: 'radio', title: 'Q3', required: false, order: 2, priorAnswerCondition: { logicType: 'AND', conditions: [{ id: 'c', name: '', enabled: true, logicType: 'AND', conditionType: 'value-match', sourceQuestionId: 'q1', requiredValues: ['never'] }] } },
  ] as unknown as Question[];

  it('스위치를 끈 문항의 이월값과 그 상세기재 사이드카를 걷어내고, 조건만 걸린 문항은 그대로 둔다', () => {
    const out = omitDisabledPriorAnswersByContact(
      new Map([
        ['t1', { q1: 'a', q2: 'b', q3: 'c', __optTexts__: { q2: { o1: '지난 상세' }, q3: { o2: 'x' } } }],
        ['t2', { q2: 'only' }],
      ]),
      questions,
    );
    expect(out.get('t1')).toEqual({ q1: 'a', q3: 'c', __optTexts__: { q3: { o2: 'x' } } });
    // 스위치 끈 문항뿐이던 대상은 빈 묶음 — 병합 시 아무것도 채우지 않는다
    expect(out.get('t2')).toEqual({});
  });

  it('걷어낸 뒤 병합하면 응답 행·미응답 행 모두 그 문항이 빈다', () => {
    const prior = omitDisabledPriorAnswersByContact(new Map([['t1', { q1: 'a', q2: 'b' }]]), questions);
    expect(mergePriorAnswersIntoResponses({}, prior.get('t1'))).toEqual({ q1: 'a' });
    expect(mergePriorAnswersIntoResponses({ q3: 'now' }, prior.get('t1'))).toEqual({ q3: 'now', q1: 'a' });
  });

  it('스위치를 끈 문항이 없으면 값이 같다', () => {
    const src = new Map([['t1', { q1: 'a' }]]);
    expect(omitDisabledPriorAnswersByContact(src, [questions[0]!]).get('t1')).toEqual({ q1: 'a' });
  });
});
