import { authed } from '@/server/orpc';

import {
  DeleteAttachmentTmpResult,
  DeleteImagesInput,
  DeleteImagesResult,
  DeleteMailAttachmentTmpInput,
  DeleteNoticeAttachmentTmpInput,
} from '../../domain/media';
import * as svc from '../services/media.service';

/** 이미지 URL 일괄 삭제 (기존 POST /api/upload/image/delete 대체). */
const deleteImages = authed
  .input(DeleteImagesInput)
  .output(DeleteImagesResult)
  .handler(({ input }) => svc.deleteImages(input));

/**
 * 메일 첨부 tmp 키 삭제 (기존 DELETE /api/upload/mail-attachment 대체).
 *
 * 메일은 전면 authed(어드민 전용) — /operations/mail 경로 자체가 게스트에게
 * guestPathRedirect 로 막혀 있어 게스트용 메일 첨부 작성 UX 는 더 이상 없다.
 * 입력에 surveyId 가 없어 assertSurveyAccess 를 못 쓰므로 authed 로 게스트를
 * 원천 차단한다 — tmp 네임스페이스 키 검증만으로는(키 자체가 사용자별이 아니므로)
 * 다른 어드민이 스테이징한 첨부를 게스트가 지울 수 있는 사고를 막지 못한다.
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
