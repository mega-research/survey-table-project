import { EXCEL_UNREADABLE_MESSAGE, ExcelReadError } from '@/lib/contacts/excel-parser';

/**
 * 읽을 수 없는 엑셀은 typed error 로 내보낸다.
 *
 * 평범한 Error 로 두면 oRPC 가 운영에서 message 를 'Internal server error' 로 마스킹해,
 * 업로드 화면이 사용자에게 원인도 대처법도 못 보여준다 (실제로 접두사 네임스페이스
 * xlsx 가 500 TypeError 로 나갔다). 명단 업로드와 이월 응답 임포트가 공유한다.
 */
export const EXCEL_UNREADABLE_ERROR = {
  EXCEL_UNREADABLE: { status: 400, message: EXCEL_UNREADABLE_MESSAGE },
} as const;

/** ExcelReadError → typed error. 그 외 예외는 그대로 통과시킨다. */
export function rethrowExcelError(
  error: unknown,
  errors: { EXCEL_UNREADABLE: (init?: { message?: string }) => Error },
): never {
  if (error instanceof ExcelReadError) {
    throw errors.EXCEL_UNREADABLE({ message: error.message });
  }
  throw error;
}
