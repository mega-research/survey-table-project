'use client';

import { useCallback, useEffect, useRef } from 'react';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { deleteImagesFromR2 } from '@/lib/image-utils';

/**
 * TipTap 에디터에서 업로드한 이미지의 R2 lifecycle 을 추적한다.
 *
 * - 마운트 시 initialHtml 의 이미지 URL을 추적 대상으로 등록
 * - editor onUpdate 시 reconcileAfterUpdate() 를 호출하면, 직전 콘텐츠와 비교해
 *   사라진 이미지를 R2에서 삭제
 * - 폼 취소 시 cleanupOrphans() 로 미사용 업로드 일괄 삭제
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

  /** onUpdate 시점에 호출 — diff 후 사라진 이미지 R2 삭제 + previous 갱신 */
  const reconcileAfterUpdate = useCallback((currentHtml: string) => {
    const previousImages = extractImageUrlsFromHtml(previousContentRef.current);
    const currentImages = extractImageUrlsFromHtml(currentHtml);
    const deletedImages = previousImages.filter(
      (url) => !currentImages.includes(url) && uploadedRef.current.has(url),
    );

    if (deletedImages.length > 0) {
      deleteImagesFromR2(deletedImages).catch((error) => {
        console.error('이미지 삭제 실패:', error);
      });
      deletedImages.forEach((url) => uploadedRef.current.delete(url));
    }

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
