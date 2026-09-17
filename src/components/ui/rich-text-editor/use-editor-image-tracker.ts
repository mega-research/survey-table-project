'use client';

import { useCallback, useEffect, useEffectEvent, useRef } from 'react';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { deleteImagesFromR2 } from '@/shared/lib/image-utils';

/**
 * TipTap 에디터에서 업로드한 이미지의 R2 lifecycle 을 추적한다.
 *
 * - 마운트 시 initialHtml 의 이미지 URL을 추적 대상으로 등록
 * - editor onUpdate 시 reconcileAfterUpdate 가 직전 콘텐츠 ref 만 갱신.
 *   R2 DELETE 는 호출하지 않는다 — 사용자가 undo/redo 로 노드를 복원할 수
 *   있고, 그 사이 R2 객체가 사라지면 publish 시 NoSuchKey 로 promote 가
 *   실패하기 때문.
 * - 폼 취소·unmount 시 cleanupOrphans 가 추적 대상 중 현재 HTML 에 없는
 *   것만 일괄 R2 DELETE. 비정상 종료는 R2 24h lifecycle 안전망.
 */
export function useEditorImageTracker(initialHtml: string) {
  const uploadedRef = useRef<Set<string>>(new Set());
  const previousContentRef = useRef<string>(initialHtml || '');

  // 마운트 시 1회만 등록한다. initialHtml 은 호출자가 폼 state 를 왕복시켜 키 입력마다
  // 바뀔 수 있으므로 deps 에 넣지 않고(넣으면 추적 집합이 누적되어 R2 삭제 대상이 달라진다)
  // effect event 로 마운트 시점의 최신값만 읽는다.
  const registerInitial = useEffectEvent(() => {
    if (!initialHtml) return;
    const initialImages = extractImageUrlsFromHtml(initialHtml);
    initialImages.forEach((url) => uploadedRef.current.add(url));
    previousContentRef.current = initialHtml;
  });
  useEffect(() => {
    registerInitial();
  }, []);

  const trackUpload = useCallback((url: string) => {
    uploadedRef.current.add(url);
  }, []);

  /**
   * onUpdate 시점에 호출 — 사라진 URL 은 추적에서만 갱신.
   * R2 DELETE 는 의도적으로 호출하지 않는다(undo 시점 보존). 실제 R2 cleanup 은
   * unmount/폼 취소 시 cleanupOrphans 가 일괄 수행하거나 24h lifecycle 이 처리.
   */
  const reconcileAfterUpdate = useCallback((currentHtml: string) => {
    previousContentRef.current = currentHtml;
  }, []);

  /** previousContentRef 강제 갱신 — setContent(emitUpdate:false) 후 stale diff 방지 */
  const resetPrevious = useCallback((html: string) => {
    previousContentRef.current = html;
  }, []);

  const getOrphans = useCallback((currentHtml: string): string[] => {
    const currentImages = extractImageUrlsFromHtml(currentHtml);
    return Array.from(uploadedRef.current).filter((url) => !currentImages.includes(url));
  }, []);

  const cleanupOrphans = useCallback(
    async (currentHtml: string) => {
      const orphans = getOrphans(currentHtml);
      if (orphans.length === 0) return;
      await deleteImagesFromR2(orphans).catch((error) => {
        console.error('orphan 이미지 삭제 실패:', error);
      });
      orphans.forEach((url) => uploadedRef.current.delete(url));
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
