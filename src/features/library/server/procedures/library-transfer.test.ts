import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/library-transfer.service', () => ({
  exportLibrary: vi.fn(),
  importLibrary: vi.fn(),
  initializePresetQuestions: vi.fn(),
}));

import * as svc from '../services/library-transfer.service';
import { transfer } from './library-transfer';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('library transfer procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('export는 service.exportLibrary의 JSON 문자열을 반환한다', async () => {
    vi.mocked(svc.exportLibrary).mockResolvedValue('{"savedQuestions":[]}' as never);
    const client = createRouterClient({ transfer }, { context: authedContext() });
    const res = await client.transfer.export();
    expect(svc.exportLibrary).toHaveBeenCalledOnce();
    expect(res).toBe('{"savedQuestions":[]}');
  });

  it('import는 입력 json을 service.importLibrary에 위임하고 ok:true를 반환한다', async () => {
    vi.mocked(svc.importLibrary).mockResolvedValue(undefined as never);
    const client = createRouterClient({ transfer }, { context: authedContext() });
    const res = await client.transfer.import({ json: '{"savedQuestions":[]}' });
    expect(svc.importLibrary).toHaveBeenCalledWith('{"savedQuestions":[]}');
    expect(res).toEqual({ ok: true });
  });

  it('initializePresets는 service 결과 배열을 반환한다', async () => {
    vi.mocked(svc.initializePresetQuestions).mockResolvedValue([
      { id: 'p1', name: '성별 질문' },
    ] as never);
    const client = createRouterClient({ transfer }, { context: authedContext() });
    const res = await client.transfer.initializePresets();
    expect(svc.initializePresetQuestions).toHaveBeenCalledOnce();
    expect(res[0]?.id).toBe('p1');
  });

  it('인증 없으면 export가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { transfer },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.transfer.export()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
