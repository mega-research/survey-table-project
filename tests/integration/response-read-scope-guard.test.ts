import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// WS-2 IDOR 봉인: response-read.service 의 getResponseById 가 surveyId 스코프를
// WHERE 에 반영해, 다른 설문 소속 응답을 단건 조회로 끄집어내지 못하도록 막는지 검증한다.
//
// 핵심 시나리오:
//   - 다른 surveyId 로 조회 -> findFirst 에 surveyId 스코프가 포함된 WHERE 가 전달되고
//     매칭 0행 -> undefined 반환(거부)
//   - 정상 surveyId -> 매칭 행 반환
//
// db 는 drizzle fluent chain 흉내. findFirst 가 받은 where 인자를 캡처해
// 스코프 조건이 실제로 WHERE 로 내려가는지 확인하고, 반환은 큐로 제어한다.

const { findFirstQueue, capturedWhere } = vi.hoisted(() => ({
  findFirstQueue: [] as unknown[],
  capturedWhere: [] as unknown[],
}));

vi.mock('@/db', () => {
  const queryStub = {
    findFirst: vi.fn((args: { where?: unknown }) => {
      capturedWhere.push(args?.where);
      return Promise.resolve(findFirstQueue.shift() ?? undefined);
    }),
  };

  return {
    db: {
      query: {
        surveyResponses: queryStub,
      },
    },
  };
});

// notDeletedResponse 는 drizzle 식 조건 객체로 PgTable self-reference 때문에
// 순환 구조다. surveyId 스코프가 WHERE 에 들어갔는지 확인하기 위해 조건 트리를
// visited set 으로 안전하게 순회하며 등장하는 문자열 리터럴을 수집한다.
function collectStrings(node: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (seen.has(node)) return [];
  seen.add(node);
  const out: string[] = [];
  for (const value of Object.values(node as Record<string, unknown>)) {
    out.push(...collectStrings(value, seen));
  }
  return out;
}

import { getResponseById } from '@/features/survey-builder/server/services/response-read.service';

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_SURVEY_ID = '99999999-8888-4777-8666-555555555555';
const RESPONSE_ID = '22222222-3333-4444-8555-666666666666';

beforeEach(() => {
  findFirstQueue.length = 0;
  capturedWhere.length = 0;
});

describe('getResponseById 설문 스코프', () => {
  it('다른 surveyId 로 조회하면 매칭 0행 -> undefined 를 반환한다', async () => {
    findFirstQueue.push(undefined); // 스코프 불일치로 0행
    const result = await getResponseById(RESPONSE_ID, OTHER_SURVEY_ID);
    expect(result).toBeUndefined();
    // WHERE 에 surveyId 스코프가 바인딩되었는지 확인
    expect(collectStrings(capturedWhere[0])).toContain(OTHER_SURVEY_ID);
  });

  it('정상 surveyId 로 조회하면 매칭 응답을 반환한다', async () => {
    findFirstQueue.push({ id: RESPONSE_ID, surveyId: SURVEY_ID });
    const result = await getResponseById(RESPONSE_ID, SURVEY_ID);
    expect(result).toMatchObject({ id: RESPONSE_ID, surveyId: SURVEY_ID });
    expect(collectStrings(capturedWhere[0])).toContain(SURVEY_ID);
  });
});
