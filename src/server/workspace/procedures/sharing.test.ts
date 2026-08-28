/**
 * 공유 설정 procedure 의 관문 (역할 모델 v2 티켓 16, .pen FLOW 4-2).
 *
 * 고정하는 것은 요구 capability 다. `survey.edit` 로 새면 팀 공개 설문의 **팀원**이 그
 * 설문을 초대 전용으로 바꿔 같은 팀에서 숨길 수 있다 — 편집권과 공유권은 다른 축이다
 * (스펙 §7: 범위 변경은 소유자·팀장·슈퍼어드민만).
 */
import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { SharingSurveyNotFoundError } from '../domain/sharing';
import * as svc from '../services/sharing';
import { sharing } from './sharing';

vi.mock('../services/sharing', () => ({ setSurveyVisibility: vi.fn() }));
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const SURVEY_ID = '22222222-2222-4222-8222-222222222222';

const context: ORPCContext = {
  db: {} as never,
  user: {
    id: ACTOR_ID,
    email: 'owner@megaresearch.co.kr',
    name: '김소유',
    status: 'active',
    isSuperadmin: false,
    userType: 'internal',
  },
  headers: new Headers(),
};

const client = createRouterClient({ sharing }, { context });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.setSurveyVisibility).mockResolvedValue({ success: true });
});

describe('sharing.setVisibility', () => {
  it('survey.manageAccess 를 요구한다 — survey.edit 이 아니다', async () => {
    await client.sharing.setVisibility({ surveyId: SURVEY_ID, visibility: 'invite_only' });

    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'survey.manageAccess',
    );
  });

  it('관문이 막으면 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(new ORPCError('FORBIDDEN'));

    await expect(
      client.sharing.setVisibility({ surveyId: SURVEY_ID, visibility: 'invite_only' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.setSurveyVisibility).not.toHaveBeenCalled();
  });

  it('두 방향 모두 서비스에 그대로 넘어간다', async () => {
    await client.sharing.setVisibility({ surveyId: SURVEY_ID, visibility: 'invite_only' });
    await client.sharing.setVisibility({ surveyId: SURVEY_ID, visibility: 'team' });

    expect(svc.setSurveyVisibility).toHaveBeenNthCalledWith(1, {
      surveyId: SURVEY_ID,
      visibility: 'invite_only',
    });
    expect(svc.setSurveyVisibility).toHaveBeenNthCalledWith(2, {
      surveyId: SURVEY_ID,
      visibility: 'team',
    });
  });

  it('관문을 지난 뒤 사라진 설문은 NOT_FOUND 로 나간다 — 조용한 성공이 아니다', async () => {
    vi.mocked(svc.setSurveyVisibility).mockRejectedValueOnce(new SharingSurveyNotFoundError());

    await expect(
      client.sharing.setVisibility({ surveyId: SURVEY_ID, visibility: 'team' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('어휘 밖 값은 입력에서 막힌다', async () => {
    await expect(
      client.sharing.setVisibility({
        surveyId: SURVEY_ID,
        visibility: 'public' as never,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(svc.setSurveyVisibility).not.toHaveBeenCalled();
  });
});
