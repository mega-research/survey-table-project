'use client';

import { useCallback, useEffect, useRef } from 'react';

import { TMP_NOTICE_ATTACHMENT_PREFIX } from '@/lib/upload/attachment-policy';

/**
 * TipTap 에디터에서 업로드한 파일 첨부의 R2 lifecycle 을 추적.
 * 이미지 트래커 use-editor-image-tracker.ts 와 동일 패턴.
 *
 * - 마운트 시 initialHtml 의 tmp/notice-attachment/ 키를 추적 대상으로 등록
 * - editor onUpdate 시 reconcileAfterUpdate 가 직전과 비교해 사라진 tmp 키 R2 DELETE
 * - 폼 취소 시 cleanupOrphans 로 미사용 tmp 키 일괄 정리
 *
 * 영구 prefix notice-attachment/ 는 추적 대상 아님 — promote 후 lifecycle 은
 * survey-save-actions 에서 별도 처리.
 */

const ATTACHMENT_TAG_RE = /<a\b[^>]*\bdata-file-attachment="true"[^>]*>/gi;
const DATA_KEY_ATTR_RE = /\bdata-key="([^"]+)"/i;

export function extractTmpAttachmentKeysFromHtml(html: string): string[] {
  if (!html) return [];
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  ATTACHMENT_TAG_RE.lastIndex = 0;
  while ((match = ATTACHMENT_TAG_RE.exec(html)) !== null) {
    const tag = match[0];
    const m = tag.match(DATA_KEY_ATTR_RE);
    if (m && m[1].startsWith(TMP_NOTICE_ATTACHMENT_PREFIX)) {
      keys.add(m[1]);
    }
  }
  return [...keys];
}

async function deleteTmpAttachmentKey(key: string): Promise<void> {
  try {
    await fetch('/api/upload/notice-attachment', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
  } catch {
    // best-effort — R2 lifecycle 가 24h 안전망
  }
}

async function deleteTmpAttachmentKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await Promise.all(keys.map((k) => deleteTmpAttachmentKey(k)));
}

export function useEditorFileAttachmentTracker(initialHtml: string) {
  const uploadedRef = useRef<Set<string>>(new Set());
  const previousContentRef = useRef<string>(initialHtml || '');

  useEffect(() => {
    if (!initialHtml) return;
    const initialKeys = extractTmpAttachmentKeysFromHtml(initialHtml);
    initialKeys.forEach((key) => uploadedRef.current.add(key));
    previousContentRef.current = initialHtml;
    // 초기 마운트 시에만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackUpload = useCallback((key: string) => {
    if (key.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX)) {
      uploadedRef.current.add(key);
    }
  }, []);

  /** onUpdate 시점에 호출 — diff 후 사라진 tmp 키 R2 삭제 + previous 갱신 */
  const reconcileAfterUpdate = useCallback((currentHtml: string) => {
    const previousKeys = extractTmpAttachmentKeysFromHtml(previousContentRef.current);
    const currentKeys = extractTmpAttachmentKeysFromHtml(currentHtml);
    const deleted = previousKeys.filter(
      (k) => !currentKeys.includes(k) && uploadedRef.current.has(k),
    );

    if (deleted.length > 0) {
      void deleteTmpAttachmentKeys(deleted);
      deleted.forEach((k) => uploadedRef.current.delete(k));
    }

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
      await deleteTmpAttachmentKeys(orphans);
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
