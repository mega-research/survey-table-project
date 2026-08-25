import { Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// db 는 실 PG 없이 drizzle where 절을 그대로 파싱해 파티션 매칭을 재현한다.
// eq()/and() 가 만드는 SQL 트리를 걷어 Param 인스턴스(encoder.name = 컬럼 SQL 명)만
// 추출한다 — where 절에 is_test 조건이 실제로 실렸는지를 (모킹이 아니라) 검증하는
// 유일한 방법이라, 이 select/update 체인은 shallow stub 이 아니라 파라미터 파싱기다.
// (src/features/survey-response/server/services/response-edit.service.test.ts 와 동일 패턴.)
function extractParams(
  node: unknown,
  out: Record<string, unknown> = {},
  seen = new Set<unknown>(),
): Record<string, unknown> {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (node instanceof Param) {
    const name = (node as unknown as { encoder?: { name?: string } }).encoder?.name;
    if (typeof name === 'string') out[name] = (node as unknown as { value: unknown }).value;
    return out;
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) extractParams(chunk, out, seen);
  }
  return out;
}

interface FakeSurvey {
  id: string;
  testModeEnabled: boolean;
}

interface FakeCampaign {
  id: string;
  surveyId: string;
  isTest: boolean;
  status: string;
}

const h = vi.hoisted(() => ({
  surveys: [] as FakeSurvey[],
  campaigns: [] as FakeCampaign[],
}));

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((where: unknown) => ({
          limit: vi.fn(async () => {
            const p = extractParams(where);
            const survey = h.surveys.find((s) => s.id === p['id']);
            return survey ? [{ enabled: survey.testModeEnabled }] : [];
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => ({
        where: vi.fn((where: unknown) => ({
          returning: vi.fn(async () => {
            const p = extractParams(where);
            const row = h.campaigns.find(
              (c) =>
                c.id === p['id'] &&
                c.surveyId === p['survey_id'] &&
                (p['is_test'] === undefined || c.isTest === p['is_test']) &&
                (c.status === 'draft' || c.status === 'queued'),
            );
            if (!row) return [];
            Object.assign(row, payload);
            return [{ id: row.id }];
          }),
        })),
      })),
    })),
  },
}));

import { cancelCampaign } from './campaigns';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';

describe('cancelCampaign 파티션 가드', () => {
  beforeEach(() => {
    h.surveys.length = 0;
    h.campaigns.length = 0;
    vi.clearAllMocks();
  });

  it('게스트는 테스트 파티션 캠페인을 취소할 수 없다', async () => {
    // 어드민이 테스트 모드를 켠 상태에서 게스트가 테스트 캠페인 id 를 알아내 직접 호출한 시나리오.
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true });
    h.campaigns.push({ id: CAMPAIGN_ID, surveyId: SURVEY_ID, isTest: true, status: 'queued' });

    await expect(
      cancelCampaign({ surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID }, true),
    ).rejects.toThrow('발송 시작 후에는 취소할 수 없습니다.');

    // 실데이터 파티션 행은 게스트 시도로 인해 조용히 바뀌지 않아야 한다.
    expect(h.campaigns[0]?.status).toBe('queued');
  });

  it('게스트는 실데이터 파티션 캠페인은 취소할 수 있다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true });
    h.campaigns.push({ id: CAMPAIGN_ID, surveyId: SURVEY_ID, isTest: false, status: 'queued' });

    await expect(
      cancelCampaign({ surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID }, true),
    ).resolves.toBeUndefined();
    expect(h.campaigns[0]?.status).toBe('cancelled');
  });

  it('어드민 경로는 그대로 동작한다(테스트 모드 캠페인을 취소)', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true });
    h.campaigns.push({ id: CAMPAIGN_ID, surveyId: SURVEY_ID, isTest: true, status: 'queued' });

    await expect(
      cancelCampaign({ surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID }, false),
    ).resolves.toBeUndefined();
    expect(h.campaigns[0]?.status).toBe('cancelled');
  });

  it('발송 시작(sending) 후에는 어드민도 취소할 수 없다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false });
    h.campaigns.push({ id: CAMPAIGN_ID, surveyId: SURVEY_ID, isTest: false, status: 'sending' });

    await expect(
      cancelCampaign({ surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID }, false),
    ).rejects.toThrow('발송 시작 후에는 취소할 수 없습니다.');
  });
});
