// 미디어(R2 유예 삭제 큐) 경계 계약 — 이력 조회 필터의 상태 어휘.
// 화면 필터 타입과 서버 zod enum 이 같은 배열에서 나오도록 어휘를 여기 둔다.
// client-safe — 런타임 의존 없음(리터럴 상수 제외).

/** 이력에서 조회 가능한 상태 — pending 은 대기 목록(listPending) 전용이라 빠진다. */
export const FILE_CLEANUP_HISTORY_STATUSES = ['cancelled', 'kept', 'deleted', 'failed'] as const;
export type FileCleanupHistoryStatus = (typeof FILE_CLEANUP_HISTORY_STATUSES)[number];
