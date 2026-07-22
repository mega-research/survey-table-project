import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FirstContactSample } from '@/lib/operations/contact-sample.server';

vi.mock('@/lib/operations/contact-sample.server', () => ({
  getFirstContactSample: vi.fn(),
}));
vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(),
}));

import { getFirstContactSample } from '@/lib/operations/contact-sample.server';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';

import { getMailPreviewSample } from './mail-preview.service';

const sampleData: FirstContactSample = {
  attrs: { name: '홍길동' },
  inviteCode: 'abc123',
  email: 'h@example.com',
  resid: 1,
};

describe('getMailPreviewSample', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('컨택 0건이면 null 을 반환한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(getFirstContactSample).mockResolvedValue(null);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com');
    const res = await getMailPreviewSample({ surveyId: 'sv-1' });
    expect(res).toBeNull();
    expect(getFirstContactSample).toHaveBeenCalledWith('sv-1', 'test');
  });

  it('NEXT_PUBLIC_APP_URL 기준으로 절대 inviteUrl 을 빌드한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com/');
    const res = await getMailPreviewSample({ surveyId: 'sv-1' });
    expect(res).toEqual({
      attrs: sampleData.attrs,
      inviteUrl: 'https://survey.example.com/i/abc123',
      email: 'h@example.com',
      resid: 1,
    });
    expect(getFirstContactSample).toHaveBeenCalledWith('sv-1', 'real');
  });

  it('NEXT_PUBLIC_APP_URL 미설정 시 relative URL 을 조용히 반환하지 않고 명시적으로 throw 한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    await expect(getMailPreviewSample({ surveyId: 'sv-1' })).rejects.toThrow(
      'NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.',
    );
  });
});
