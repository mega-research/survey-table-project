import { authed, scoped } from '@/server/orpc';

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
 * 게스트 메일 첨부 작성 UX 에 필요. 입력에 surveyId 가 없어 설문 관문
 * (assertScopedSurveyCapabilityRpc) 부착 불가 — 도메인의 tmp 네임스페이스 키 검증
 * (임의 키 삭제 불가)에 의존한다. scoped 표면의 유일한 무관문 예외(티켓 10 유지).
 */
const deleteMailAttachmentTmp = scoped
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
