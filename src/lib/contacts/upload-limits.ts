import { formatBytes } from '@/lib/utils';

/**
 * 조사 대상 엑셀 업로드 한도 — 클라이언트(업로드 마법사)와 서버 액션이 함께 참조.
 * exceljs 등 서버 전용 의존이 없는 순수 모듈이라 'use client' 컴포넌트에서도 안전하게 import.
 * 한 곳에서만 고치면 양쪽이 동기화된다 (상수 drift 방지).
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_UPLOAD_ROWS = 20_000;

/**
 * 업로드 파일이 xlsx 확장자 + 용량 한도를 만족하는지 검증.
 * @returns 위반 시 사용자용 에러 메시지, 정상이면 null.
 *   서버는 throw, 클라이언트는 상태 표시 등 호출부 정책에 따라 결과를 사용.
 */
export function validateXlsxFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return '엑셀 .xlsx 파일만 업로드할 수 있습니다.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `파일이 너무 큽니다 (${formatBytes(file.size)}). 최대 ${formatBytes(MAX_UPLOAD_BYTES)} 까지 가능합니다.`;
  }
  return null;
}
