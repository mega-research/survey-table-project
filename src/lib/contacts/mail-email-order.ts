import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';
import { piiKeyOf } from '@/lib/operations/contacts-format';

/**
 * 메일 발송 주소 순서 — 명단에 이메일 열이 여럿일 때 어느 열의 주소로 보낼지.
 * 서버(발송·사전 점검·미리보기·반송 제외·가드)와 클라이언트(컬럼 설정)가 공유하는 순수 모듈 —
 * 'server-only' 금지.
 *
 * ── 배선과 규칙 ──
 * - **메일 발송 주소 순서** (2026-10-14): 명단에 이메일로 암호화된 열이 여럿이면(대표자 e-mail · 실무자 e-mail
 *   …) 컬럼 설정(`contacts/columns`)의 「발송 주소 순서」로 어느 열의 주소로 보낼지 정한다 — 이메일 열이 둘
 *   이상일 때만 열이 나온다.
 * - 저장은 컬럼별 `mailOrder`(1부터)이고 파티션마다 스킴이 따로라 순서도 따로다.
 * - **순위를 준 열만 후보**이고 순위 오름차순으로 값이 있는 첫 열의 주소를 쓴다(1순위가 비면 다음 순위).
 * - 순위 밖 열에만 주소가 있는 대상은 발송되지 않고 사전 점검이 「이메일 누락」으로 센다.
 * - **어느 열에도 순위가 없으면 종전대로 `column_key` 오름차순 첫 열**이다 — 그래서 미설정 설문은 `대표자
 *   e-mail` 이 `실무자 e-mail` 을 이긴다.
 * - 해석은 `lib/contacts/mail-email-order.ts` 의 `resolveMailEmailOrder`(→ `MailEmailOrder`, null = 미지정) 한
 *   곳이다.
 * - 이 순서를 타는 자리는 일곱이다 — 발송(`createCampaign`, 스코프 SHARE 잠금으로 스킴을 같이 읽는다) · 사전
 *   점검(`preflightRecipients`) · 후보 목록·제외 집계(`hasEmailCandidateSql`) · 반송 제외
 *   예고(`listBouncedContactIds` — 파티션을 가리지 않는 함수라 `is_test` 로 순서를 갈라 쓴다) · 단건 선검증 ·
 *   미리보기 샘플 · 수신거부 화면(`loadSendEmailForTarget`).
 * - 일곱 모두 아래 「발송 주소 모듈」을 거친다.
 * - 교체 업로드는 스킴을 다시 만들지만 순서는 열 이름이 같은 이메일 열에 이어 붙인다(`carryOverMailOrder`) —
 *   빠지면 재업로드 한 번에 조용히 대표자 주소로 돌아간다.
 * - 이미 만든 캠페인은 `email_snapshot` 이 고정이라 영향이 없다.
 * - 대상별 지정(컨택 상세에서 한 명만 다른 열로)은 미구현이다.
 */

/**
 * 발송 주소 후보 열의 contact_pii.column_key 를 순위대로 늘어놓은 것.
 * null = 순위 지정 없음 — 이메일 열 전부가 후보이고 열 이름 오름차순이다(종전 동작).
 * 배열이면 거기 든 열만 후보다. 빈 배열은 만들지 않는다.
 */
export type MailEmailOrder = readonly string[] | null;

/** 발송 주소 순위를 걸 수 있는 열인지 — 이메일로 암호화된 열만. */
export function canOrderMailEmail(col: Pick<ContactColumnDef, 'source' | 'piiType'>): boolean {
  return col.piiType === 'email' && piiKeyOf(col.source) !== null;
}

function isValidMailOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * 컬럼 스킴 → 발송 주소 순서.
 * 순위가 같으면 컬럼 설정의 표시 순서(order)가 앞선 열이 먼저다. 순위 사이의 빈 번호는 무시한다.
 */
export function resolveMailEmailOrder(
  scheme: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): MailEmailOrder {
  const columns = scheme?.columns;
  if (!Array.isArray(columns)) return null;
  const ranked = columns
    .filter((c) => canOrderMailEmail(c) && isValidMailOrder(c.mailOrder))
    .sort((a, b) => (a.mailOrder as number) - (b.mailOrder as number) || a.order - b.order)
    .map((c) => piiKeyOf(c.source) as string);
  const unique = [...new Set(ranked)];
  return unique.length > 0 ? unique : null;
}

/**
 * 저장 전 검사 — 문제가 있으면 사용자에게 보일 문구, 없으면 null.
 * 순위는 이메일로 암호화된 열에만, 1 이상의 정수로, 열마다 다른 값이어야 한다.
 */
export function validateMailEmailOrder(columns: readonly ContactColumnDef[]): string | null {
  const ordered = columns.filter((c) => c.mailOrder != null);
  if (ordered.some((c) => !canOrderMailEmail(c))) {
    return '발송 주소 순서는 이메일로 암호화된 열에만 지정할 수 있습니다.';
  }
  if (ordered.some((c) => !isValidMailOrder(c.mailOrder))) {
    return '발송 주소 순서는 1 이상의 정수여야 합니다.';
  }
  const ranks = ordered.map((c) => c.mailOrder);
  if (new Set(ranks).size !== ranks.length) {
    return '같은 발송 주소 순서를 여러 열에 지정할 수 없습니다.';
  }
  return null;
}

/**
 * 한 열의 순위를 바꾼 새 컬럼 목록. rank=null 이면 순위를 지운다.
 * 그 순위를 이미 쓰던 열은 바꾼 열의 이전 순위를 넘겨받는다(맞바꿈) — 이전 순위가 없었으면 순위를 잃는다.
 */
export function assignMailOrder(
  columns: readonly ContactColumnDef[],
  index: number,
  rank: number | null,
): ContactColumnDef[] {
  const previous = columns[index]?.mailOrder;
  return columns.map((c, i) => {
    if (i === index) {
      const { mailOrder: _drop, ...rest } = c;
      return rank != null ? { ...rest, mailOrder: rank } : rest;
    }
    if (rank != null && c.mailOrder === rank) {
      const { mailOrder: _drop, ...rest } = c;
      return previous != null ? { ...rest, mailOrder: previous } : rest;
    }
    return c;
  });
}

/**
 * 교체 업로드로 스킴을 다시 만들 때 이전 순위를 옮긴다.
 * 열 이름이 같고 여전히 이메일로 암호화된 열만 이어받는다 — 옮기지 않으면 재업로드 한 번에
 * 순서가 조용히 열 이름순으로 돌아가 엉뚱한 주소로 발송된다.
 */
export function carryOverMailOrder(
  next: ContactColumnScheme,
  previous: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): ContactColumnScheme {
  const prevColumns = previous?.columns;
  if (!Array.isArray(prevColumns)) return next;
  const rankByKey = new Map<string, number>();
  for (const c of prevColumns) {
    if (canOrderMailEmail(c) && isValidMailOrder(c.mailOrder)) rankByKey.set(c.key, c.mailOrder);
  }
  if (rankByKey.size === 0) return next;
  return {
    ...next,
    columns: next.columns.map((c) => {
      const rank = rankByKey.get(c.key);
      return rank != null && canOrderMailEmail(c) ? { ...c, mailOrder: rank } : c;
    }),
  };
}
