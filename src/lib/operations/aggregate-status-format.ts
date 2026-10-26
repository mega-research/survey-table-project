/**
 * 운영 현황 콘솔 — A1 KPI Row를 위한 응답 상태 집계.
 *
 * DB는 snake_case 상태값을 저장하지만 (`screened_out`, `quotaful_out`),
 * 컴포넌트에서 다루기 쉽도록 camelCase 필드로 매핑한다.
 *
 * 파일 구성:
 *   - 본 파일: 타입 정의 + 순수 변환 함수 `mapRowsToCounts` (서버 의존성 없음 → 테스트 가능)
 *   - server/operations/services/aggregate-status.ts: 실제 DB 호출 어댑터 `aggregateStatus`
 */

export interface StatusCounts {
  /**
   * 적격 모수의 합계 (completed + fieldworkCompleted + quotafulOut + bad + drop).
   * in_progress 는 진행중 셀로 별도 노출되어 제외되고, screened_out 은 부적격이라 제외된다.
   */
  total: number;
  completed: number;
  /**
   * 실사 완료 처리 — 온라인 완료 없이 완료 결과코드가 기록된 조사 대상 수(응답 행이 아니라 사람 수).
   * 이 사람들의 온라인 이탈·불량·쿼터마감 행은 그 버킷에서 빼고 여기로만 센다 — 한 사람을 전체에 두 번 넣지 않는다.
   */
  fieldworkCompleted: number;
  /** status = 'screened_out' */
  screenedOut: number;
  /** status = 'quotaful_out' */
  quotafulOut: number;
  /** status = 'bad' */
  bad: number;
  /** status = 'drop' */
  drop: number;
  /** status = 'in_progress' — total 분모에서 제외되며, KPI Row의 진행중 셀로 별도 노출됨 */
  inProgress: number;
}

export interface StatusRow {
  status: string;
  count: number;
  /** 실사 완료 처리된 조사 대상의 응답 행 — 종결 미완료 버킷(쿼터마감·불량·이탈)에 넣지 않는다. */
  fieldworkCompleted?: boolean;
}

/** 실사 완료 처리된 조사 대상이면 자기 버킷 대신 실사 완료 처리로 세는 상태 — 전체에 들어가는 미완료 종결 상태다. */
export const FIELDWORK_ABSORBED_STATUSES: readonly string[] = ['quotaful_out', 'bad', 'drop'];

/**
 * 순수 함수: DB 조회 결과(상태별 행)를 StatusCounts 객체로 변환.
 *
 * - 알려진 status는 해당 필드에 합산한다.
 * - 알려지지 않은 status(예: DB 마이그레이션 중간상태, 잘못된 값)는 무시하고
 *   total에만 합산한다 — 방어적 처리. KPI Row가 throw 하지 않는 것이
 *   운영자에게 더 유용하다고 판단했다.
 * - count가 음수/NaN인 케이스는 발생하지 않는다고 가정한다 (Postgres COUNT 결과).
 * - `fieldworkCompleted` 는 조사 대상 집계라 행으로 오지 않고 따로 받는다. 표식이 붙은
 *   쿼터마감·불량·이탈 행은 그 사람이 이미 실사 완료 처리에 들어 있으므로 버리고,
 *   진행중·자격미달 행은 전체 밖이라 그대로 센다.
 */
export function mapRowsToCounts(rows: StatusRow[], fieldworkCompleted = 0): StatusCounts {
  const counts: StatusCounts = {
    total: 0,
    completed: 0,
    fieldworkCompleted,
    screenedOut: 0,
    quotafulOut: 0,
    bad: 0,
    drop: 0,
    inProgress: 0,
  };

  for (const { status, count, fieldworkCompleted: absorbed } of rows) {
    if (absorbed && FIELDWORK_ABSORBED_STATUSES.includes(status)) continue;
    switch (status) {
      case 'completed':
        counts.completed += count;
        break;
      case 'screened_out':
        counts.screenedOut += count;
        break;
      case 'quotaful_out':
        counts.quotafulOut += count;
        break;
      case 'bad':
        counts.bad += count;
        break;
      case 'drop':
        counts.drop += count;
        break;
      case 'in_progress':
        counts.inProgress += count;
        break;
      // default: 알려지지 않은 status — 어떤 버킷에도 넣지 않음
    }
  }

  // 종결 응답만 합산 (in_progress 제외) — Total은 "끝까지 진행된 응답"의 의미.
  // screened_out(자격미달)은 부적격이라 분모에서 빠진다 — 조사 대상이 아니었던 응답이므로
  // 전체·완료 어느 쪽에도 세지 않는다 (ADR: 자격미달 부적격 처리).
  counts.total =
    counts.completed +
    counts.fieldworkCompleted +
    counts.quotafulOut +
    counts.bad +
    counts.drop;

  return counts;
}
