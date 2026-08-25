import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectEmailPiiRows } from '@/lib/crypto/contact-pii-repo';
import { getResultCodeStatuses } from '@/server/read-models/result-code-statuses';

import { createCampaign } from './campaigns';
import { sendSingleCampaign } from './single-send';
import { getMailTemplate } from './templates';

const selectResultQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock('@/db', () => {
  const chainFactory = () => {
    const chain: Record<string, unknown> = {};
    chain['from'] = () => chain;
    chain['where'] = () => chain;
    chain['orderBy'] = () => chain;
    chain['limit'] = async () => selectResultQueue.shift() ?? [];
    return chain;
  };
  return { db: { select: vi.fn(() => chainFactory()) } };
});

vi.mock('./campaigns', () => ({
  createCampaign: vi.fn(async () => ({ campaignId: 'camp-1', queuedCount: 1, skippedCount: 0 })),
}));

vi.mock('./templates', () => ({
  getMailTemplate: vi.fn(async () => ({ id: 'tpl-1', name: '리마인더' })),
}));

vi.mock('@/server/read-models/result-code-statuses', () => ({
  getResultCodeStatuses: vi.fn(async () => ({ negative: [] })),
  buildNegativeCodeExists: vi.fn(() => sql`FALSE`),
}));

// 이메일 존재 검사는 contact-pii-repo 의 selectEmailPiiRows seam 을 탄다 — db 체인 큐와 분리해 고정한다.
vi.mock('@/lib/crypto/contact-pii-repo', () => ({
  selectEmailPiiRows: vi.fn(async () => []),
}));

const INPUT = { surveyId: 'sv-1', contactTargetId: 'ct-1', mailTemplateId: 'tpl-1' };
const EMAIL_ROW = {
  id: 'pii-1',
  contactTargetId: 'ct-1',
  columnKey: 'email',
  cipher: 'v1:cipher',
  maskHint: null,
};

describe('sendSingleCampaign 가드', () => {
  beforeEach(() => {
    selectResultQueue.length = 0;
    vi.clearAllMocks();
  });

  it('컨택이 없으면 에러', async () => {
    selectResultQueue.push([]); // contact 조회 empty
    await expect(sendSingleCampaign(INPUT, 'admin-1', false)).rejects.toThrow(
      '조사 대상을 찾을 수 없습니다.',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('수신거부 컨택이면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: new Date() }]);
    await expect(sendSingleCampaign(INPUT, 'admin-1', false)).rejects.toThrow(
      '수신거부된 조사 대상',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('부정 결과코드가 기록된 컨택이면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    vi.mocked(getResultCodeStatuses).mockResolvedValueOnce({ positive: [], negative: ['DNC'] });
    selectResultQueue.push([{ id: 'ct-1' }]); // 부정 결과코드 존재
    await expect(sendSingleCampaign(INPUT, 'admin-1', false)).rejects.toThrow(
      '연락금지 결과코드가 기록된',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('이메일 PII 가 없으면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(selectEmailPiiRows).mockResolvedValueOnce([]); // email pii empty
    await expect(sendSingleCampaign(INPUT, 'admin-1', false)).rejects.toThrow('이메일 정보가 없는');
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('템플릿이 없으면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(selectEmailPiiRows).mockResolvedValueOnce([EMAIL_ROW]);
    vi.mocked(getMailTemplate).mockResolvedValueOnce(null);
    await expect(sendSingleCampaign(INPUT, 'admin-1', false)).rejects.toThrow(
      '메일 템플릿을 찾을 수 없습니다.',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('가드 통과 시 kind=single 로 createCampaign 위임', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(selectEmailPiiRows).mockResolvedValueOnce([EMAIL_ROW]);
    const res = await sendSingleCampaign(INPUT, 'admin-1', false);
    expect(createCampaign).toHaveBeenCalledWith(
      {
        surveyId: 'sv-1',
        mailTemplateId: 'tpl-1',
        title: '단건: 리마인더',
        contactTargetIds: ['ct-1'],
      },
      'admin-1',
      false,
      { kind: 'single' },
    );
    expect(res).toEqual({ campaignId: 'camp-1', queuedCount: 1, skippedCount: 0 });
  });
});
