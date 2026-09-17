import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/media', () => ({
  deleteImages: vi.fn(),
  deleteMailAttachmentTmp: vi.fn(),
  deleteNoticeAttachmentTmp: vi.fn(),
}));

import * as svc from '../services/media';
import { media } from './media';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'},
  };
}

function anonContext(): ORPCContext {
  return { db: {} as never, user: null };
}

describe('media procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('deleteImages는 입력을 service.deleteImages에 위임한다', async () => {
    vi.mocked(svc.deleteImages).mockResolvedValue({
      success: true,
      deleted: 1,
      failed: 0,
      deletedUrls: ['https://r2.example.com/img.webp'],
      failedUrls: [],
    } as never);
    const client = createRouterClient({ media }, { context: authedContext() });
    const input = { urls: ['https://r2.example.com/img.webp'] };
    const res = await client.media.deleteImages(input);
    expect(svc.deleteImages).toHaveBeenCalledWith(input);
    expect(res.deleted).toBe(1);
    expect(res.deletedUrls[0]).toBe('https://r2.example.com/img.webp');
  });

  it('deleteMailAttachmentTmp는 tmp 키를 service에 위임한다', async () => {
    vi.mocked(svc.deleteMailAttachmentTmp).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ media }, { context: authedContext() });
    const input = { key: 'tmp/mail-attachment/abc.pdf' };
    const res = await client.media.deleteMailAttachmentTmp(input);
    expect(svc.deleteMailAttachmentTmp).toHaveBeenCalledWith(input);
    expect(res.ok).toBe(true);
  });

  it('deleteMailAttachmentTmp는 영구 prefix 키를 input 검증에서 막는다', async () => {
    const client = createRouterClient({ media }, { context: authedContext() });
    await expect(
      client.media.deleteMailAttachmentTmp({ key: 'mail-attachment/abc.pdf' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.deleteMailAttachmentTmp).not.toHaveBeenCalled();
  });

  it('deleteNoticeAttachmentTmp는 path traversal 키를 input 검증에서 막는다', async () => {
    const client = createRouterClient({ media }, { context: authedContext() });
    await expect(
      client.media.deleteNoticeAttachmentTmp({
        key: 'tmp/notice-attachment/../secret.pdf',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.deleteNoticeAttachmentTmp).not.toHaveBeenCalled();
  });

  it('인증 없으면 deleteImages가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ media }, { context: anonContext() });
    await expect(
      client.media.deleteImages({ urls: [] }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(svc.deleteImages).not.toHaveBeenCalled();
  });

  // 티켓 21 이 이 표면을 scoped → authed 로 옮겼다 — 메일은 게스트에게 항상 차단이라
  // 「surveyId 가 없어 관문을 못 다는 예외」를 비내부 계정에 열어 둘 이유가 없다.
  it('게스트 계정은 deleteMailAttachmentTmp 가 FORBIDDEN 이다', async () => {
    const client = createRouterClient(
      { media },
      {
        context: {
          db: {} as never,
          user: {
            id: 'guest-1',
            email: 'g@b.com',
            name: '게스트',
            status: 'active',
            isSuperadmin: false,
            userType: 'guest',
          },
        },
      },
    );
    await expect(
      client.media.deleteMailAttachmentTmp({ key: 'tmp/mail-attachment/abc.pdf' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.deleteMailAttachmentTmp).not.toHaveBeenCalled();
  });
});
