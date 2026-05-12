import * as Sentry from '@sentry/nextjs';

import type { MailAttachment } from '@/db/schema/schema-types';
import { deleteR2ObjectsByKey, moveR2Objects } from '@/lib/image-utils-server';

import {
  PERMANENT_ATTACHMENT_PREFIX,
  TMP_ATTACHMENT_PREFIX,
} from './constants';

export class AttachmentPromoteError extends Error {
  failedKeys: string[];
  constructor(failedKeys: string[]) {
    super(`메일 첨부 promote 실패: ${failedKeys.length}개 객체가 영구 위치로 이동되지 못함`);
    this.failedKeys = failedKeys;
    this.name = 'AttachmentPromoteError';
  }
}

/**
 * 메일 템플릿의 첨부 배열에서 tmp/mail-attachment/ key 를 영구 mail-attachment/ key 로
 * promote 한다.
 *
 * 1. tmp/mail-attachment/ prefix 만 추출
 * 2. R2 COPY + DELETE (1차 시도 + 실패분 1회 retry)
 * 3. 모두 성공이면 영구 key 로 교체된 새 배열 반환
 * 4. 1개라도 실패하면 — 이미 옮긴 영구 orphan 을 cleanup 후 AttachmentPromoteError throw.
 *    DB 갱신이 일어나지 않으므로 영구 orphan 은 cleanup orchestrator 가 못 잡아낸다.
 */
export async function promoteMailAttachments(
  attachments: MailAttachment[],
): Promise<MailAttachment[]> {
  if (attachments.length === 0) return attachments;

  const initialPairs = attachments
    .filter((a) => a.key.startsWith(TMP_ATTACHMENT_PREFIX))
    .map((a) => ({
      srcKey: a.key,
      dstKey:
        PERMANENT_ATTACHMENT_PREFIX + a.key.slice(TMP_ATTACHMENT_PREFIX.length),
    }));

  if (initialPairs.length === 0) return attachments;

  let allMoved = [] as Array<{ srcKey: string; dstKey: string }>;
  let stillFailed: string[] = [];

  const first = await moveR2Objects(initialPairs);
  allMoved = first.movedKeys;
  stillFailed = first.failed;

  // R2 read-after-write 일시 불일치나 transient 네트워크 케이스 대비 1회 retry
  if (stillFailed.length > 0) {
    const retryPairs = initialPairs.filter((p) => stillFailed.includes(p.srcKey));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await moveR2Objects(retryPairs);
    allMoved = [...allMoved, ...second.movedKeys];
    stillFailed = second.failed;
  }

  if (stillFailed.length > 0) {
    // 이미 영구 위치로 옮긴 객체는 DB 갱신이 일어나지 않아 cleanup orchestrator 도
    // 못 잡아내는 orphan 이 됨. 같은 batch 의 부분 성공분을 즉시 폐기.
    if (allMoved.length > 0) {
      deleteR2ObjectsByKey(allMoved.map((p) => p.dstKey)).catch(() => undefined);
    }
    Sentry.captureMessage(
      `메일 첨부 promote 최종 실패: ${stillFailed.length}개`,
      {
        level: 'error',
        tags: { operation: 'attachment_promote', kind: 'mail' },
        extra: {
          failedKeys: stillFailed,
          rolledBackKeys: allMoved.map((p) => p.dstKey),
        },
      },
    );
    throw new AttachmentPromoteError(stillFailed);
  }

  const movedMap = new Map(allMoved.map((p) => [p.srcKey, p.dstKey]));
  return attachments.map((a) => {
    const promoted = movedMap.get(a.key);
    return promoted ? { ...a, key: promoted } : a;
  });
}
