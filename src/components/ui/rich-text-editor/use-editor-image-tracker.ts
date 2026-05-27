'use client';

import { useCallback, useEffect, useRef } from 'react';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { deleteImagesFromR2 } from '@/lib/image-utils';

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

  useEffect(() => {
    if (!initialHtml) return;
    const initialImages = extractImageUrlsFromHtml(initialHtml);
    initialImages.forEach((url) => uploadedRef.current.add(url));
    previousContentRef.current = initialHtml;
    // 초기 마운트 시에만 실행 (initialHtml은 부모 prop 으로 고정)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const cleanupOrphans = useCallback(async (currentHtml: string) => {
    const orphans = getOrphans(currentHtml);
    if (orphans.length === 0) return;
    await deleteImagesFromR2(orphans).catch((error) => {
      console.error('orphan 이미지 삭제 실패:', error);
    });
    orphans.forEach((url) => uploadedRef.current.delete(url));
  }, [getOrphans]);

  return {
    trackUpload,
    reconcileAfterUpdate,
    resetPrevious,
    getOrphans,
    cleanupOrphans,
  };
}
