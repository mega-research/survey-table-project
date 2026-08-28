import { authed } from '@/server/orpc';

import {
  DeleteAttachmentTmpResult,
  DeleteImagesInput,
  DeleteImagesResult,
  DeleteMailAttachmentTmpInput,
  DeleteNoticeAttachmentTmpInput,
} from '../domain/media';
import * as svc from '../services/media';

/** 이미지 URL 일괄 삭제 (기존 POST /api/upload/image/delete 대체). */
const deleteImages = authed
  .input(DeleteImagesInput)
  .output(DeleteImagesResult)
  .handler(({ input }) => svc.deleteImages(input));

/**
 * 메일 첨부 tmp 키 삭제 (기존 DELETE /api/upload/mail-attachment 대체).
 *
 * **티켓 21 에서 scoped → authed 로 옮겼다.** 예전에는 게스트가 메일 첨부를 작성했으므로
 * scoped 였고, 입력에 surveyId 가 없어 설문 관문을 달 수 없는 「유일한 무관문 예외」로
 * 남아 있었다. v2 에서 메일은 게스트에게 **항상 차단**이라(스펙 §5) 그 예외를 유지할 이유가
 * 사라졌고, 관문 없는 문이 비내부 계정에 열려 있는 상태 자체가 계약과 어긋난다.
 *
 * 이제 임의 키 삭제를 막는 것은 두 겹이다 — 내부 계정만 통과하는 베이스와, 도메인의
 * tmp 네임스페이스 키 검증. 그 결과 **scoped 베이스는 전부 surveyId 를 받고 전부 관문을
 * 진다**(cross-team-idor-rpc 가 그 사실을 목록으로 고정한다).
 */
const deleteMailAttachmentTmp = authed
  .input(DeleteMailAttachmentTmpInput)
  .output(DeleteAttachmentTmpResult)
  .handler(({ input }) => svc.deleteMailAttachmentTmp(input));

/** 공지 첨부 tmp 키 삭제 (기존 DELETE /api/upload/notice-attachment 대체). */
const deleteNoticeAttachmentTmp = authed
  .input(DeleteNoticeAttachmentTmpInput)
  .output(DeleteAttachmentTmpResult)
  .handler(({ input }) => svc.deleteNoticeAttachmentTmp(input));

export const media = {
  deleteImages,
  deleteMailAttachmentTmp,
  deleteNoticeAttachmentTmp,
};
