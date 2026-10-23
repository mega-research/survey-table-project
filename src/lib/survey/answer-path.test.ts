import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BranchRule, Question, QuestionGroup, QuestionOption } from '@/types/survey';
import { responsesToLookupShape } from '@/utils/branch-eval';
import { collectTraversedQuestionIds } from '@/utils/branch-logic';
import { buildRenderSteps, stepIdOf } from '@/utils/group-ordering';

import { createAnswerEvalCtx } from './answer-eval-ctx';
import { stripUnreachedQuestionValues } from './answer-path';

/**
 * 경로 밖 문항 응답 — 분기 이동(goto/end)으로 건너뛴 페이지의 답을 지운다.
 *
 * 응답 화면이 제출 검증에 쓰는 경로(`collectTraversedQuestionIds` + `buildRenderSteps`)와
 * 같은 함수를 쓰는지, 경로를 확정할 수 없을 때 건너뛰는지(fail-safe)를 본다.
 */

const OPT = (value: string, branchRule?: BranchRule): QuestionOption => ({
  id: `opt-${value}`,
  label: value,
  value,
  ...(branchRule ? { branchRule } : {}),
});

const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), order, ...extra }) as Question;

const GOTO_Q3: BranchRule = { id: 'r-goto', value: 'skip', action: 'goto', targetQuestionId: 'q3' };
const SCREEN_END: BranchRule = {
  id: 'r-screen',
  value: 'out',
  action: 'end',
  endOutcome: 'screened_out',
};

/** 1페이지 q1(건너뛰기 분기) / 2페이지 q2(자격미달 보기) / 3페이지 q3 */
const SKIP_SURVEY: Question[] = [
  Q('q1', 0, { options: [OPT('skip', GOTO_Q3), OPT('stay')] }),
  Q('q2', 1, { pageBreakBefore: true, options: [OPT('out', SCREEN_END), OPT('in')] }),
  Q('q3', 2, { pageBreakBefore: true, options: [OPT('a'), OPT('b')] }),
];

const ctxOf = (responses: Record<string, unknown>) => ({
  responses: responsesToLookupShape(responses),
  contactAttrs: {},
  lookups: [],
});

function strip(
  questions: Question[],
  responses: Record<string, unknown>,
  options: Parameters<typeof stripUnreachedQuestionValues>[4] = {},
  groups: QuestionGroup[] = [],
) {
  return stripUnreachedQuestionValues(questions, responses, groups, ctxOf(responses), options);
}

describe('stripUnreachedQuestionValues — 경로 밖 문항', () => {
  it('전진 goto 로 건너뛴 페이지의 답을 지운다', () => {
    const result = strip(SKIP_SURVEY, { q1: 'skip', q2: 'in', q3: 'a' });

    expect(result.responses).toEqual({ q1: 'skip', q3: 'a' });
    expect(result.pathSkipped).toBeNull();
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q1', 'q3']);
  });

  it('건너뛴 페이지에 남은 자격미달 보기도 지운다', () => {
    const result = strip(SKIP_SURVEY, { q1: 'skip', q2: 'out', q3: 'a' });
    expect(result.responses).toEqual({ q1: 'skip', q3: 'a' });
  });

  it('end 로 끝난 뒤쪽 페이지의 답을 지운다', () => {
    const result = strip(SKIP_SURVEY, { q1: 'stay', q2: 'out', q3: 'a' });
    expect(result.responses).toEqual({ q1: 'stay', q2: 'out' });
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q1', 'q2']);
  });

  it('아직 가지 않은 뒤쪽 경로 페이지(진행 중)는 지우지 않는다', () => {
    const input = { q1: 'stay' };
    const result = strip(SKIP_SURVEY, input);
    expect(result.responses).toBe(input);
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q1', 'q2', 'q3']);

    // 앞에서 미리 적어 둔 뒤 페이지 답도 경로 위라 그대로다
    const ahead = { q1: 'stay', q3: 'b' };
    expect(strip(SKIP_SURVEY, ahead).responses).toBe(ahead);
  });

  it('뒤로 가는 goto 는 무시된다 — 응답 화면과 같이 다음 페이지로 간다', () => {
    const back: BranchRule = { id: 'r-back', value: 'back', action: 'goto', targetQuestionId: 'q1' };
    const questions = [
      Q('q1', 0, { options: [OPT('x')] }),
      Q('q2', 1, { pageBreakBefore: true, options: [OPT('back', back)] }),
      Q('q3', 2, { pageBreakBefore: true }),
    ];
    const input = { q1: 'x', q2: 'back', q3: 'a' };
    expect(strip(questions, input).responses).toBe(input);
  });

  it('지울 것이 없으면 입력 참조를 그대로 돌려준다', () => {
    const input = { q1: 'stay', q2: 'in', q3: 'a' };
    expect(strip(SKIP_SURVEY, input).responses).toBe(input);
  });

  it('경로 밖 문항의 루트 사이드카 항목도 지운다', () => {
    const result = strip(SKIP_SURVEY, {
      q1: 'skip',
      q2: 'in',
      __optTexts__: { q2: { 'opt-in': '기타' }, q1: { 'opt-skip': '유지' } },
    });
    expect(result.responses).toEqual({
      q1: 'skip',
      __optTexts__: { q1: { 'opt-skip': '유지' } },
    });
  });

  it('지운 답을 조건으로 쓰던 경로 위 문항도 고정점까지 따라 지운다', () => {
    const questions = [
      ...SKIP_SURVEY,
      Q('q4', 3, {
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c-q2',
              enabled: true,
              logicType: 'AND',
              conditionType: 'value-match',
              sourceQuestionId: 'q2',
              requiredValues: ['in'],
            },
          ],
        },
      } as Partial<Question>),
    ];
    const result = strip(questions, { q1: 'skip', q2: 'in', q3: 'a', q4: 'b' });
    expect(result.responses).toEqual({ q1: 'skip', q3: 'a' });
  });

  it('숨은 문항 strip 도 함께 돈다', () => {
    const questions = [
      Q('q1', 0, { options: [OPT('yes'), OPT('no')] }),
      Q('q2', 1, {
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c1',
              enabled: true,
              logicType: 'AND',
              conditionType: 'value-match',
              sourceQuestionId: 'q1',
              requiredValues: ['yes'],
            },
          ],
        },
      } as Partial<Question>),
    ];
    const result = strip(questions, { q1: 'no', q2: 'x' });
    expect(result.responses).toEqual({ q1: 'no' });
    expect([...result.inScopeQuestionIds]).toEqual(['q1']);
  });

  it('어느 페이지에도 들지 않는 문항(없는 그룹 소속)은 판정할 수 없어 남긴다', () => {
    const questions = [...SKIP_SURVEY, Q('q-orphan', 9, { groupId: 'gone' })];
    const result = strip(questions, { q1: 'skip', q2: 'in', 'q-orphan': 'x' });
    expect(result.responses).toEqual({ q1: 'skip', 'q-orphan': 'x' });
    expect(result.inScopeQuestionIds.has('q-orphan')).toBe(false);
  });
});

describe('stripUnreachedQuestionValues — 응답 인용값', () => {
  it('응답 인용 이름을 읽는 표시 조건도 인용값을 얹은 컨텍스트로 경로를 정한다', () => {
    const questions: Question[] = [
      {
        ...SKIP_SURVEY[0]!,
        answerQuoteEnabled: true,
        answerQuoteName: '선택',
        options: [
          { ...OPT('skip', GOTO_Q3), answerQuoteText: 'skip' },
          { ...OPT('stay'), answerQuoteText: 'stay' },
        ],
      } as Question,
      SKIP_SURVEY[1]!,
      Q('q3', 2, {
        pageBreakBefore: true,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c-quote',
              enabled: true,
              logicType: 'AND',
              conditionType: 'expression',
              expressionConfig: {
                clauses: [
                  {
                    kind: 'comparison',
                    comparison: {
                      left: { kind: 'attr', attrsKey: '선택' },
                      op: '==',
                      right: { kind: 'literal', value: 'skip' },
                    },
                  },
                ],
                joinOps: [],
              },
            },
          ],
        },
      } as unknown as Partial<Question>),
    ];
    // 응답 화면은 명단 값(`선택=stay`) 위에 인용값(`skip`)을 얹어 q3 를 보인다 — 서버도 같아야 한다.
    const input = { q1: 'skip', q2: 'in', q3: 'a' };
    const result = stripUnreachedQuestionValues(
      questions,
      input,
      [],
      createAnswerEvalCtx({ questions, contactAttrs: { 선택: 'stay' }, lookups: [] }),
    );
    expect(result.pathSkipped).toBeNull();
    expect(result.responses).toEqual({ q1: 'skip', q3: 'a' });
  });
});

describe('stripUnreachedQuestionValues — 경로를 확정할 수 없으면 건너뛴다', () => {
  it('문항 섞기 설문은 경로 밖 strip 을 하지 않는다', () => {
    const input = { q1: 'skip', q2: 'out', q3: 'a' };
    const result = strip(SKIP_SURVEY, input, { settings: { shuffleQuestions: true } });
    expect(result.responses).toBe(input);
    expect(result.pathSkipped).toBe('shuffle');
    // 남은 문항은 표시 조건 기준으로만 센다
    expect([...result.inScopeQuestionIds].sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('문항 섞기 설문도 숨은 문항 strip 은 그대로 한다', () => {
    const questions = [
      ...SKIP_SURVEY,
      Q('q4', 3, {
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c1',
              enabled: true,
              logicType: 'AND',
              conditionType: 'value-match',
              sourceQuestionId: 'q1',
              requiredValues: ['stay'],
            },
          ],
        },
      } as Partial<Question>),
    ];
    const result = strip(
      questions,
      { q1: 'skip', q2: 'in', q4: 'x' },
      { settings: { shuffleQuestions: true } },
    );
    expect(result.responses).toEqual({ q1: 'skip', q2: 'in' });
  });

  it('기록된 마지막 페이지가 계산한 경로 위에 없으면 건너뛴다', () => {
    const steps = buildRenderSteps(SKIP_SURVEY, []);
    const page2 = stepIdOf(steps[1]!);
    const page3 = stepIdOf(steps[2]!);
    const input = { q1: 'skip', q2: 'in', q3: 'a' };

    const offPath = strip(SKIP_SURVEY, input, { lastStepId: page2 });
    expect(offPath.pathSkipped).toBe('last-step-off-path');
    expect(offPath.responses).toBe(input);

    const onPath = strip(SKIP_SURVEY, input, { lastStepId: page3 });
    expect(onPath.pathSkipped).toBeNull();
    expect(onPath.responses).toEqual({ q1: 'skip', q3: 'a' });
  });

  it('기록된 마지막 페이지가 지금 구조에 없으면 건너뛴다', () => {
    const input = { q1: 'skip', q2: 'in' };
    const result = strip(SKIP_SURVEY, input, { lastStepId: 'page:sunset' });
    expect(result.pathSkipped).toBe('last-step-unknown');
    expect(result.responses).toBe(input);
  });

  it('마지막 페이지 기록이 없으면(null) 그 확인은 하지 않는다', () => {
    const result = strip(SKIP_SURVEY, { q1: 'skip', q2: 'in' }, { lastStepId: null });
    expect(result.pathSkipped).toBeNull();
    expect(result.responses).toEqual({ q1: 'skip' });
  });
});

describe('응답 화면 경로 ↔ 서버 경로', () => {
  it('응답 화면은 같은 페이지 빌더와 같은 경로 시뮬레이션을 쓴다', () => {
    // 응답 화면이 페이지를 다르게 만들기 시작하면(기기 폭·조사표 분할로 페이지를 쪼개는 등) 서버
    // 경로가 어긋나 멀쩡한 답을 지운다. 그때는 이 테스트가 먼저 깨진다 — answer-path 도 같이 바꿀 것.
    const root = join(__dirname, '../../features/survey-response');
    const flow = readFileSync(join(root, 'survey-response-flow.tsx'), 'utf8');
    const lifecycle = readFileSync(join(root, 'hooks/use-response-lifecycle.ts'), 'utf8');

    expect(flow).toMatch(/buildRenderSteps\(questions, groups\)/);
    expect(flow.match(/buildRenderSteps\(/g)).toHaveLength(1);
    expect(flow).toMatch(/resolveStepBranch\(steps, currentStepIndex, rules\)/);
    expect(lifecycle).toMatch(/collectTraversedQuestionIds\(/);
  });

  /**
   * 응답 화면은 `buildRenderSteps(questions, groups)` 로 페이지를 만들고 제출 검증·응답 수를
   * `collectTraversedQuestionIds` 로 센다(survey-response-flow · use-response-lifecycle). 서버가
   * 남기는 문항은 그 경로와 같아야 한다 — 고정점 반복이 없는(첫 바퀴로 끝나는) 시나리오에서
   * 둘을 그대로 비교한다.
   */
  const GROUPS: QuestionGroup[] = [
    { id: 'g1', surveyId: 's', name: 'A', order: 0 } as QuestionGroup,
    { id: 'g2', surveyId: 's', name: 'B', order: 1 } as QuestionGroup,
  ];
  const GROUPED: Question[] = [
    Q('a1', 0, { groupId: 'g1', options: [OPT('skip', { ...GOTO_Q3, targetQuestionId: 'b2' })] }),
    Q('a2', 1, { groupId: 'g1', pageBreakBefore: true, options: [OPT('x')] }),
    Q('b1', 0, { groupId: 'g2', pageBreakBefore: true, options: [OPT('x')] }),
    Q('b2', 1, { groupId: 'g2', pageBreakBefore: true, options: [OPT('out', SCREEN_END)] }),
    Q('u1', 0, { pageBreakBefore: true, options: [OPT('x')] }),
  ];

  const cases: Array<[string, Question[], QuestionGroup[], Record<string, unknown>]> = [
    ['goto 건너뛰기', SKIP_SURVEY, [], { q1: 'skip', q2: 'in', q3: 'a' }],
    ['end 종료', SKIP_SURVEY, [], { q1: 'stay', q2: 'out', q3: 'a' }],
    ['분기 없음', SKIP_SURVEY, [], { q1: 'stay', q2: 'in', q3: 'b' }],
    ['그룹 간 goto + end', GROUPED, GROUPS, { a1: 'skip', a2: 'x', b1: 'x', b2: 'out', u1: 'x' }],
    ['그룹 미응답', GROUPED, GROUPS, { a2: 'x', b1: 'x', u1: 'x' }],
  ];

  it.each(cases)('%s — 남는 문항 = 응답 화면의 경로', (_name, questions, groups, responses) => {
    const steps = buildRenderSteps(questions, groups);
    const clientPath = collectTraversedQuestionIds(
      steps,
      responses,
      questions,
      groups,
      ctxOf(responses),
    );
    const result = strip(questions, responses, {}, groups);

    expect(new Set(Object.keys(result.responses))).toEqual(
      new Set(Object.keys(responses).filter((id) => clientPath.has(id))),
    );
    expect(result.inScopeQuestionIds).toEqual(clientPath);
  });
});
