/**
 * 운영 콘솔 응답자 목록 페이지의 표시용 pure helper.
 *
 * 모든 함수는 입력만으로 출력이 결정되며, 단위 테스트는
 * `tests/unit/domains/operations/profiles.test.ts` 에 둔다.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV6_FULL_RE = /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i

/**
 * 응답자 IP 를 표시용으로 마스킹한다.
 *
 * - IPv4 → 끝 옥텟을 `xx` 로: `123.45.67.89` → `123.45.67.xx`
 * - IPv6 (전체 8그룹) → 마지막 4그룹을 `xxxx` 로: 처음 64bit (네트워크 prefix) 만 노출
 * - null / 빈 문자열 / 축약형(::1) / 비정상 입력 → `—`
 *
 * 운영자가 같은 회사·사무실에서 들어온 응답을 구분할 수 있을 정도로만 노출하고
 * 마지막 식별 단위는 가린다.
 */
export function formatIpMask(ip: string | null | undefined): string {
  if (!ip) return '—'

  const v4 = IPV4_RE.exec(ip)
  if (v4) {
    return `${v4[1]}.${v4[2]}.${v4[3]}.xx`
  }

  if (IPV6_FULL_RE.test(ip)) {
    const groups = ip.split(':')
    return [...groups.slice(0, 4), 'xxxx', 'xxxx', 'xxxx', 'xxxx'].join(':')
  }

  return '—'
}

/**
 * 응답 소요시간을 운영자 시점 표시 문자열로 변환.
 *
 * - `in_progress` → 항상 "진행 중" (소요시간 표기 무의미)
 * - `total_seconds = null` → "—"
 * - 음수 (시계 역행) → 0 으로 클램프
 * - 그 외 → 분 단위 반올림: "X분"
 *
 * 분 미만은 운영 가시성에 의미가 없어 정수 분으로만 표기.
 */
export function formatTotalTime(
  totalSeconds: number | null | undefined,
  status: string,
): string {
  if (status === 'in_progress') return '진행 중'
  if (totalSeconds === null || totalSeconds === undefined) return '—'
  const clamped = Math.max(0, totalSeconds)
  const minutes = Math.round(clamped / 60)
  return `${minutes}분`
}

const Q_NUMBER_RE = /^(Q\d+(?:-\d+)?)\b/

/**
 * question.title 의 prefix 에서 `Q3` / `Q5-1` / `Q33-1` 같은 질문번호를 추출한다.
 *
 * - 매치 실패 → null (notice 같은 비-Q 항목)
 * - prefix 가 아닌 곳에 Q 가 들어 있어도 매치 안 됨 (의도)
 */
export function parseQuestionNumberFromTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const m = Q_NUMBER_RE.exec(title)
  return m ? m[1] : null
}
