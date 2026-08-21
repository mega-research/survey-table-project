import * as Sentry from '@sentry/nextjs';

import type { MailAttachment } from '@/shared/contracts/mail';
import { copyR2Objects } from '@/lib/image-utils-server';

import {
  PERMANENT_ATTACHMENT_PREFIX,
  TMP_ATTACHMENT_PREFIX,
} from '@/lib/mail/constants';

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
 * 2. R2 COPY-only (1차 시도 + 실패분 1회 retry) — 원본(tmp)은 삭제하지 않는다
 * 3. 모두 성공이면 영구 key 로 교체된 새 배열 반환
 * 4. 1개라도 실패하면 AttachmentPromoteError throw. 이번 호출이 이미 영구 위치로 copy 한
 *    객체는 롤백하지 않는다 — tmp 원본이 그대로 남아있어 재시도하면 다시 copy 될 뿐이다.
 *    (과거엔 move 라 이 시점에 유일 사본이던 dst 를 롤백 삭제해 방금 업로드한 파일이
 *    영구 소실되는 사고가 있었다. copy-only 전환으로 그 롤백 자체를 제거했다.)
 *
 * tmp 잔여물은 R2 lifecycle(tmp/ 24h) 위임 — 대시보드 규칙 존재 확인 필요(키 권한으로 코드에서 미검증).
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

  const first = await copyR2Objects(initialPairs);
  allMoved = first.movedKeys;
  stillFailed = first.failed;

  // R2 read-after-write 일시 불일치나 transient 네트워크 케이스 대비 1회 retry
  if (stillFailed.length > 0) {
    const retryPairs = initialPairs.filter((p) => stillFailed.includes(p.srcKey));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await copyR2Objects(retryPairs);
    allMoved = [...allMoved, ...second.movedKeys];
    stillFailed = second.failed;
  }

  if (stillFailed.length > 0) {
    // copy-only 이므로 이번 호출에서 이미 영구 위치로 copy 한 객체(allMoved)를
    // 롤백하지 않는다 — tmp 원본이 그대로 남아있어 재시도하면 다시 copy 될 뿐이고,
    // dst 삭제는 과거 "유일 사본(dst) 삭제 사고"의 원인이었으므로 의도적으로 하지 않는다.
    Sentry.captureMessage(
      `메일 첨부 promote 최종 실패: ${stillFailed.length}개 (tmp 원본 보존 — 재시도 가능)`,
      {
        level: 'error',
        tags: { operation: 'attachment_promote', kind: 'mail' },
        extra: { failedKeys: stillFailed },
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
