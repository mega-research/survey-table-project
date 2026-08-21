import { describe, expect, it, vi } from 'vitest';

// getSurveyWithDetails와 db 트랜잭션을 모킹한다.
// 게이트 테스트 목적: 유효하지 않은 변수명이 있는 설문은 배포 전에 SpssVarNameError를 던진다.
// 트랜잭션은 게이트 통과 전에 도달하지 않으므로 db는 stub으로 충분하다.
vi.mock('@/data/surveys', () => ({
  getSurveyWithDetails: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    transaction: vi.fn(),
  },
}));

// buildSurveySnapshot은 순수 함수이므로 실제 구현 사용
// (게이트 오류 경로에서는 호출되지 않으므로 모킹 불필요)
vi.mock('@/lib/versioning/snapshot-builder', () => ({
  buildSurveySnapshot: vi.fn().mockReturnValue({}),
}));

import { getSurveyWithDetails } from '@/data/surveys';
import { isSpssVarNameError } from '@/lib/spss/variable-name-guard';
import type { Question, Survey } from '@/types/survey';
import { publishSurvey } from '@/server/survey-builder/services/survey-publish.service';

const SURVEY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeSurvey(questions: Partial<Question>[]): Survey {
  return {
    id: SURVEY_ID,
    title: '테스트 설문',
    questions: questions.map((q, i) => ({
      id: `q${i + 1}`,
      type: 'radio',
      title: `질문${i + 1}`,
      required: false,
      order: i + 1,
      options: [],
      ...q,
    })) as Question[],
    groups: [],
  } as unknown as Survey;
}

describe('publishSurvey — SPSS 변수명 게이트', () => {
  it('유효하지 않은 변수명(대시 포함)이 있으면 SpssVarNameError를 던진다', async () => {
    // Q-1 은 허용되지 않는 문자(-)가 포함되어 있어 게이트에서 차단되어야 한다
    vi.mocked(getSurveyWithDetails).mockResolvedValue(
      makeSurvey([{ questionCode: 'Q-1', type: 'radio', options: [{ id: 'o1', label: '예', value: 'o1' }] }]),
    );

    await expect(publishSurvey({ surveyId: SURVEY_ID })).rejects.toSatisfy(isSpssVarNameError);
  });

  it('유효한 변수명이면 게이트를 통과해 트랜잭션까지 도달한다', async () => {
    vi.mocked(getSurveyWithDetails).mockResolvedValue(
      makeSurvey([{ questionCode: 'Q1', type: 'radio', options: [{ id: 'o1', label: '예', value: 'o1' }] }]),
    );

    const { db } = await import('@/db');
    // 트랜잭션 진입 시 에러를 던져 실DB 없이 "게이트 통과"를 확인
    vi.mocked(db.transaction).mockRejectedValue(new Error('db-stub'));

    await expect(publishSurvey({ surveyId: SURVEY_ID })).rejects.toThrow('db-stub');
    // SpssVarNameError가 아닌 일반 에러 → 게이트는 통과
    expect(db.transaction).toHaveBeenCalled();
  });
});
