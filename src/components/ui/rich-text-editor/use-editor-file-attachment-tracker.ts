'use client';

import { useCallback, useEffect, useEffectEvent, useRef } from 'react';

import { TMP_NOTICE_ATTACHMENT_PREFIX } from '@/lib/upload/attachment-policy';

import { extractTmpAttachmentKeysFromHtml } from './file-attachment-html-utils';
import { deleteTmpNoticeAttachmentKeys } from './file-attachment-r2-client';

/**
 * TipTap 에디터에서 업로드한 파일 첨부의 R2 lifecycle 을 추적.
 *
 * - 마운트 시 initialHtml 의 tmp/notice-attachment/ 키를 추적 대상으로 등록
 * - editor onUpdate 시 reconcileAfterUpdate 가 직전과 비교해 사라진 tmp 키를
 *   uploadedRef 에서만 즉시 제거(추적 해제). R2 DELETE 는 호출하지 않는다 —
 *   사용자가 undo/redo 로 노드를 복원할 수 있고, 그 사이 R2 객체가 사라지면
 *   publish 시 NoSuchKey 로 promote 가 실패하기 때문.
 * - 폼 취소·unmount 시 cleanupOrphans 가 추적 대상 중 현재 HTML 에 없는 것만
 *   일괄 R2 DELETE. 비정상 종료(브라우저 close 등)는 R2 24h lifecycle 안전망.
 *
 * 영구 prefix notice-attachment/ 는 추적 대상 아님 — promote 후 lifecycle 은
 * survey-save-actions 에서 별도 처리.
 */

// 기존 호출부 / 테스트 호환을 위한 re-export.
export { extractTmpAttachmentKeysFromHtml };

export function useEditorFileAttachmentTracker(initialHtml: string) {
  const uploadedRef = useRef<Set<string>>(new Set());
  const previousContentRef = useRef<string>(initialHtml || '');

  // 마운트 시 1회만 등록한다(use-editor-image-tracker 와 동일 사유 — initialHtml 은 키 입력마다
  // 바뀔 수 있어 deps 에 넣으면 추적 집합이 누적된다). effect event 로 마운트 시점 값만 읽는다.
  const registerInitial = useEffectEvent(() => {
    if (!initialHtml) return;
    const initialKeys = extractTmpAttachmentKeysFromHtml(initialHtml);
    initialKeys.forEach((key) => uploadedRef.current.add(key));
    previousContentRef.current = initialHtml;
  });
  useEffect(() => {
    registerInitial();
  }, []);

  const trackUpload = useCallback((key: string) => {
    if (key.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX)) {
      uploadedRef.current.add(key);
    }
  }, []);

  /**
   * onUpdate 시점에 호출 — 사라진 tmp 키는 추적에서만 제거.
   * R2 DELETE 는 의도적으로 호출하지 않는다(undo 시점 보존). 실제 R2 cleanup 은
   * unmount/폼 취소 시 cleanupOrphans 가 일괄 수행하거나 24h lifecycle 이 처리.
   */
  const reconcileAfterUpdate = useCallback((currentHtml: string) => {
    previousContentRef.current = currentHtml;
  }, []);

  /** previousContentRef 강제 갱신 — setContent emitUpdate:false 후 stale diff 방지 */
  const resetPrevious = useCallback((html: string) => {
    previousContentRef.current = html;
  }, []);

  const getOrphans = useCallback((currentHtml: string): string[] => {
    const currentKeys = extractTmpAttachmentKeysFromHtml(currentHtml);
    return Array.from(uploadedRef.current).filter((k) => !currentKeys.includes(k));
  }, []);

  const cleanupOrphans = useCallback(
    async (currentHtml: string) => {
      const orphans = getOrphans(currentHtml);
      if (orphans.length === 0) return;
      await deleteTmpNoticeAttachmentKeys(orphans);
      orphans.forEach((k) => uploadedRef.current.delete(k));
    },
    [getOrphans],
  );

  return {
    trackUpload,
    reconcileAfterUpdate,
    resetPrevious,
    getOrphans,
    cleanupOrphans,
  };
}
