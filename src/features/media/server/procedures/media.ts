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

/** 메일 첨부 tmp 키 삭제 (기존 DELETE /api/upload/mail-attachment 대체). */
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
