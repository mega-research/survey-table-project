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

/**
 * 적재할 행이 하나도 없는 업로드인가 — 그렇다면 사용자용 거부 사유, 아니면 null.
 *
 * 0행 업로드는 어떤 모드에서도 뜻이 없고, replace 에서는 기존 조사 대상을 전부 지운 뒤 아무것도
 * 넣지 않아 명단이 통째로 사라진다(개별 링크·회차 기록·PII 포함). 엑셀 필터가 전 행을 걸러 낸
 * 파일을 「숨겨진 행 제외」로 올리면 이 상태가 된다 — 그 경우 빠진 행 수와 푸는 방법을 알려 준다.
 * 마법사(실행 전)와 서버(삭제 전)가 같은 문구를 쓴다.
 */
export function emptyUploadProblem(rowCount: number, skippedHiddenRows: number): string | null {
  if (rowCount > 0) return null;
  if (skippedHiddenRows > 0) {
    return `적재할 행이 없습니다. 엑셀에서 숨겨진 ${skippedHiddenRows.toLocaleString('ko-KR')}행을 빼면 남는 행이 없습니다 — 엑셀의 필터를 풀거나 숨겨진 행을 포함해 적재해 주세요.`;
  }
  return '적재할 행이 없습니다. 헤더 행 아래에 데이터가 있는지 확인해 주세요.';
}
