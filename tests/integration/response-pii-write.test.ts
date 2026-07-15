import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env['CONTACT_PII_AES_KEY'] = Buffer.alloc(32, 7).toString('base64');

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

const {
  responseFindFirstMock,
  surveyFindFirstMock,
  executeMock,
  updateSetLogMock,
  updateReturningMock,
  flagsMock,
} = vi.hoisted(() => ({
  responseFindFirstMock: vi.fn(),
  surveyFindFirstMock: vi.fn(),
  executeMock: vi.fn(),
  updateSetLogMock: vi.fn(),
  updateReturningMock: vi.fn(),
  flagsMock: vi.fn(),
}));

function makeUpdateChain() {
  return {
    set: vi.fn((v: unknown) => {
      updateSetLogMock(v);
      return {
        where: vi.fn(() => ({ returning: vi.fn(() => updateReturningMock()) })),
      };
    }),
  };
}

vi.mock('@/db', () => {
  const db: Record<string, unknown> = {
    execute: (...a: unknown[]) => executeMock(...a),
    update: vi.fn(() => makeUpdateChain()),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
      })),
    })),
    query: {
      surveys: { findFirst: (...a: unknown[]) => surveyFindFirstMock(...a) },
      surveyResponses: { findFirst: (...a: unknown[]) => responseFindFirstMock(...a) },
    },
  };
  return { db };
});

// updateQuestionResponse 가 참조하는 제어 플래그 조회 목 (실제 import 경로: @/lib/survey-control)
vi.mock('@/lib/survey-control', () => ({
  getSurveyControlFlags: (...a: unknown[]) => flagsMock(...a),
  isValidTestToken: vi.fn(() => false),
}));

/**
 * db.update(...).set(v) 에 전달되는 v 는 drizzle sql`` 청크(SQL/StringChunk/Param/Column)를
 * 값으로 갖는 객체다. Column/Table 인스턴스는 서로를 순환 참조하므로 JSON.stringify 가
 * 그대로는 불가능(circular structure) — queryChunks/StringChunk.value/Param.value 만
 * 재귀적으로 따라가 원시값(string/number/boolean)을 모아 하나의 문자열로 합친다.
 * Column/Table 등 인식하지 못하는 객체는 순회하지 않고 건너뛴다(순환 회피).
 */
function collectSqlChunkStrings(node: unknown, out: string[], seen: Set<unknown>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    out.push(String(node));
    return;
  }
  if (typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectSqlChunkStrings(item, out, seen);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj['queryChunks'])) {
    collectSqlChunkStrings(obj['queryChunks'], out, seen);
    return;
  }
  if ('value' in obj && (Array.isArray(obj['value']) || typeof obj['value'] === 'string')) {
    collectSqlChunkStrings(obj['value'], out, seen);
    return;
  }
  // 순수 객체 리터럴({} 프로토타입)은 set() 인자 최상위 객체(questionResponses/progressPct 키)
  // 이므로 값들을 재귀 순회한다. Column/Table 등 drizzle 내부 클래스 인스턴스는 순환 참조
  // 가능성이 있어(프로토타입이 Object.prototype 이 아님) 여기서 걸러 건너뛴다.
  const proto = Object.getPrototypeOf(obj);
  if (proto === Object.prototype || proto === null) {
    for (const v of Object.values(obj)) collectSqlChunkStrings(v, out, seen);
  }
}

function extractSqlSetParams(setArg: Record<string, unknown>): string {
  const out: string[] = [];
  collectSqlChunkStrings(setArg, out, new Set());
  return out.join('\n');
}

const RESPONSE_ID = '00000000-0000-4000-8000-00000000r001';
const VERSION_ID = '00000000-0000-4000-8000-00000000v001';
const SURVEY_ID = '00000000-0000-4000-8000-00000000s001';
const QUESTION_ID = 'q-pii-1';

describe('updateQuestionResponse — PII 문항 암호화', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      isTest: false,
    });
    flagsMock.mockResolvedValue({ isPaused: false });
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('스냅샷에서 piiEncrypted=true 면 jsonb_set 값이 v1: 암호문이다', async () => {
    executeMock.mockResolvedValue([{ pii: true }]);
    const { updateQuestionResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await updateQuestionResponse({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: '010-1234-5678',
    });
    // set() 에 전달된 questionResponses sql 청크에서 원시 파라미터 문자열을 수집한다
    // (JSON.stringify 는 Column/Table 순환 참조로 불가 — collectSqlChunkStrings 사용).
    const setArg = updateSetLogMock.mock.calls[0]![0] as Record<string, unknown>;
    const serialized = extractSqlSetParams(setArg);
    expect(serialized).not.toContain('010-1234-5678');
    expect(serialized).toMatch(/v\d+:/);
  });

  it('piiEncrypted=false 면 평문 그대로 저장한다', async () => {
    executeMock.mockResolvedValue([{ pii: false }]);
    const { updateQuestionResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await updateQuestionResponse({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: '평문 답변',
    });
    const setArg = updateSetLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(extractSqlSetParams(setArg)).toContain('평문 답변');
  });
});
