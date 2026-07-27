import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/media.service', () => ({
  deleteImages: vi.fn(),
  deleteMailAttachmentTmp: vi.fn(),
  deleteNoticeAttachmentTmp: vi.fn(),
}));

import * as svc from '../services/media.service';
import { media } from './media';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  };
}

function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
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

  it('게스트도 deleteMailAttachmentTmp 를 위임받는다 (surveyId 없어 tmp 네임스페이스 검증에만 의존)', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:sv-1');
    vi.mocked(svc.deleteMailAttachmentTmp).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient(
      { media },
      { context: { db: {} as never, supabase: {} as never, user: { id: 'guest-1', email: 'g@b.com' } } },
    );
    const input = { key: 'tmp/mail-attachment/abc.pdf' };
    const res = await client.media.deleteMailAttachmentTmp(input);
    expect(svc.deleteMailAttachmentTmp).toHaveBeenCalledWith(input);
    expect(res.ok).toBe(true);
  });
});
