import { ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureMessage = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { MAX_UPLOAD_ROWS } from '@/lib/contacts/upload-limits';
import { isSentryWorthyRpcError } from '@/server/rpc-error-policy';
import { assertUploadRowLimit } from './upload-row-limit';

describe('assertUploadRowLimit', () => {
  beforeEach(() => {
    captureMessage.mockReset();
  });

  it('한도 이하면 통과하고 Sentry 에 아무것도 남기지 않는다', () => {
    expect(() =>
      assertUploadRowLimit(MAX_UPLOAD_ROWS, { operation: 'contact_upload_preview' }),
    ).not.toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('한도를 넘으면 BAD_REQUEST 로 거부해 장애 알림 경로를 타지 않는다', () => {
    let thrown: unknown;
    try {
      assertUploadRowLimit(MAX_UPLOAD_ROWS + 1, {
        operation: 'contact_upload_ingest',
        surveyId: 'survey-1',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect((thrown as ORPCError<string, unknown>).code).toBe('BAD_REQUEST');
    expect((thrown as Error).message).toBe(
      `최대 ${MAX_UPLOAD_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다 (현재 ${(MAX_UPLOAD_ROWS + 1).toLocaleString('ko-KR')} 행).`,
    );
    expect(isSentryWorthyRpcError(thrown)).toBe(false);
  });

  it('한도 초과는 고정 메시지의 warning 으로 따로 남긴다', () => {
    expect(() =>
      assertUploadRowLimit(25_000, { operation: 'prior_answer_import', surveyId: 'survey-1' }),
    ).toThrow();

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('엑셀 업로드 행 수 한도 초과', {
      level: 'warning',
      tags: { operation: 'prior_answer_import', surveyId: 'survey-1' },
      extra: { rowCount: 25_000, limit: MAX_UPLOAD_ROWS },
    });
  });
});
