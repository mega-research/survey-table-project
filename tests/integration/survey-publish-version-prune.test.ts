/**
 * 발행 트랜잭션 확장 계약 (2026-07-31 spec 5.3 ②, 6.2).
 * 계약: 새 버전 생성 → 그 스냅샷의 R2 키를 인덱스에 기록 → 보존 규칙에
 *       미달하는 직전 버전 정리. 모두 같은 트랜잭션(tx).
 *
 * mock 구조는 tests/integration/publish-spss-gate.test.ts 의 관례를 따른다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findPrunableMock, pruneMock, recordRefsMock } = vi.hoisted(() => ({
  findPrunableMock: vi.fn(async () => [] as string[]),
  pruneMock: vi.fn(async () => ({ pruned: 0, registeredKeys: 0 })),
  recordRefsMock: vi.fn(async () => 0),
}));

vi.mock('@/lib/versioning/version-retention.server', () => ({
  findPrunableVersionIds: findPrunableMock,
}));
vi.mock('@/lib/versioning/version-prune.server', () => ({
  pruneVersionSnapshots: pruneMock,
}));
vi.mock('@/lib/r2-lifecycle/key-ref-index.server', () => ({
  recordKeyRefs: recordRefsMock,
}));

vi.mock('@/data/surveys', () => ({ getSurveyWithDetails: vi.fn() }));
vi.mock('@/db', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@/lib/versioning/snapshot-builder', () => ({
  buildSurveySnapshot: vi
    .fn()
    .mockReturnValue({ questions: [{ imageUrl: 'https://cdn-dev.megaresearch.co.kr/survey/a.png' }] }),
}));

import { getSurveyWithDetails } from '@/data/surveys';
import { db } from '@/db';
import { publishSurvey } from '@/features/survey-builder/server/services/survey-publish.service';
import type { Question, Survey } from '@/types/survey';

const SURVEY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NEW_VERSION_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const OLD_VERSION_ID = 'cccccccc-dddd-4eee-8fff-000000000000';

/** 발행 트랜잭션이 tx 에서 쓰는 최소 표면만 흉내낸다. */
function makeTx() {
  return {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    query: { surveyVersions: { findFirst: async () => ({ versionNumber: 3 }) } },
    insert: () => ({
      values: () => ({
        returning: async () => [
          { id: NEW_VERSION_ID, versionNumber: 4, surveyId: SURVEY_ID },
        ],
      }),
    }),
  };
}

function makeSurvey(): Survey {
  return {
    id: SURVEY_ID,
    title: '테스트 설문',
    questions: [
      {
        id: 'q1',
        type: 'radio',
        title: '질문1',
        required: false,
        order: 1,
        questionCode: 'Q1',
        options: [{ id: 'o1', label: '예', value: 'o1' }],
      },
    ] as Question[],
    groups: [],
  } as unknown as Survey;
}

/**
 * db.transaction 이 실제로 생성해 콜백에 넘긴 tx 인스턴스.
 * 각 테스트가 recordKeyRefs/findPrunableVersionIds/pruneVersionSnapshots 호출의
 * 첫 인자가 "어떤 객체든"이 아니라 "바로 이 tx"였음을 identity 로 검증하기 위해
 * beforeEach 에서 캡처해둔다 — module-level db 가 실수로 흘러들어가도
 * expect.anything() 으로는 잡히지 않지만 이 방식이면 실패한다.
 */
let capturedTx: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  capturedTx = undefined;
  findPrunableMock.mockResolvedValue([]);
  vi.mocked(getSurveyWithDetails).mockResolvedValue(makeSurvey());
  vi.mocked(db.transaction).mockImplementation(async (cb) => {
    capturedTx = makeTx();
    return cb(capturedTx as never);
  });
});

describe('publishSurvey — 인덱스 기록과 직전 버전 정리', () => {
  it('새 버전의 R2 키를 survey_versions 소스로 인덱스에 기록한다', async () => {
    await publishSurvey({ surveyId: SURVEY_ID });

    expect(recordRefsMock).toHaveBeenCalledWith(
      capturedTx,
      'survey_versions',
      NEW_VERSION_ID,
      expect.arrayContaining(['survey/a.png']),
    );
  });

  it('보존 규칙에 미달하는 직전 버전을 같은 트랜잭션에서 정리한다', async () => {
    findPrunableMock.mockResolvedValueOnce([OLD_VERSION_ID]);

    await publishSurvey({ surveyId: SURVEY_ID });

    expect(pruneMock).toHaveBeenCalledWith(
      capturedTx,
      [OLD_VERSION_ID],
      expect.stringContaining('발행'),
    );
  });

  it('정리 대상이 없으면 정리를 호출하지 않는다', async () => {
    findPrunableMock.mockResolvedValueOnce([]);

    await publishSurvey({ surveyId: SURVEY_ID });

    expect(pruneMock).not.toHaveBeenCalled();
  });

  it('방금 만든 새 버전은 정리 대상에서 제외한다', async () => {
    findPrunableMock.mockResolvedValueOnce([NEW_VERSION_ID, OLD_VERSION_ID]);

    await publishSurvey({ surveyId: SURVEY_ID });

    expect(pruneMock).toHaveBeenCalledWith(
      capturedTx,
      [OLD_VERSION_ID],
      expect.any(String),
    );
  });

  it('정리 대상 조회를 해당 설문으로 한정한다', async () => {
    await publishSurvey({ surveyId: SURVEY_ID });

    expect(findPrunableMock).toHaveBeenCalledWith(capturedTx, { surveyId: SURVEY_ID });
  });
});
