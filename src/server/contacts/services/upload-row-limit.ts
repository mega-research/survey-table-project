import { ORPCError } from '@orpc/server';
import * as Sentry from '@sentry/nextjs';
import 'server-only';

import { MAX_UPLOAD_ROWS } from '@/lib/contacts/upload-limits';

/**
 * 엑셀 행 수 한도 가드 — 명단 업로드(미리보기·매칭·적재)와 이월 응답 임포트가 공유한다.
 *
 * 평범한 Error 로 던지면 oRPC 가 운영에서 message 를 'Internal server error' 로 마스킹하고,
 * 로깅 미들웨어가 장애로 분류해 Sentry error 로 보낸다. 한도 초과는 장애가 아니라 예상된
 * 거부라 BAD_REQUEST 로 내보내 사용자에게 문구를 그대로 보인다.
 *
 * 다만 누가 한도를 넘는 파일을 올렸는지는 계속 알고 싶어서 warning 으로 따로 남긴다.
 * 메시지는 고정 문자열이다 — 행 수를 넣으면 이벤트마다 이슈가 갈라진다.
 */
export function assertUploadRowLimit(
  rowCount: number,
  context: { operation: string; surveyId?: string },
): void {
  if (rowCount <= MAX_UPLOAD_ROWS) return;

  Sentry.captureMessage('엑셀 업로드 행 수 한도 초과', {
    level: 'warning',
    tags: {
      operation: context.operation,
      ...(context.surveyId ? { surveyId: context.surveyId } : {}),
    },
    extra: { rowCount, limit: MAX_UPLOAD_ROWS },
  });
  throw new ORPCError('BAD_REQUEST', {
    message: `최대 ${MAX_UPLOAD_ROWS.toLocaleString('ko-KR')} 행까지 적재 가능합니다 (현재 ${rowCount.toLocaleString('ko-KR')} 행).`,
  });
}
