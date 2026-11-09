import type { FieldworkShareReleaseRow } from '@/shared/contracts/contacts-io';

/**
 * 명단 교체 업로드 경고 목록의 「풀릴 담당 범위」 줄 (fieldwork-multi-company 티켓 09, ADR-0035).
 *
 * 교체 업로드는 실데이터 조사 대상을 지우고 새로 만든다 — 담당 범위가 대상과 함께 사라지고, 나눈 링크는
 * 「나눈 적 있음」이 남아 **다시 나눌 때까지 0명**을 본다(새 명단으로 넓어지지 않는다). 재료는 서버의
 * `countFieldworkSharesToRelease`(열린 외주 링크 중 범위가 있는 것만, 발급 순)다. 이름표는 글자로만 그린다.
 */
export function ShareReleaseWarning({ rows }: { rows: readonly FieldworkShareReleaseRow[] }) {
  if (rows.length === 0) return null;
  const summary = rows.map((r) => `${r.name} ${r.count.toLocaleString('ko-KR')}명`).join(' · ');
  return (
    <>
      <li className="font-semibold">풀릴 담당 범위: {summary}</li>
      <li>
        담당 범위를 나눈 외주 링크는 다시 나눌 때까지 0명을 봅니다 — 업로드 뒤 외주 담당 범위에서 다시
        나누세요
      </li>
    </>
  );
}
