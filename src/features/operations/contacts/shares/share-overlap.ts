import type {
  FieldworkShareChangeSummary,
  FieldworkShareOverlap,
} from '@/shared/contracts/contacts-io';

/**
 * 담당 범위 적용의 겹침 처리 의미론 (fieldwork-multi-company 티켓 04, ADR-0035).
 *
 * 서버의 적용 SQL(`server/contacts/services/fieldwork-shares.ts`)이 이 표를 손으로 옮긴 사본이고, 수정 화면은
 * `shareCountAfter` 로 고른 처리에 따른 적용 뒤 인원을 미리 보인다. 실제로 SQL 이 이 표대로 쓰는지는
 * `fieldwork-share-overlap.realdb` 「적용 SQL 은 화면의 의미론 표와 같다」가 이 함수로 기댓값을 내어 맞춘다.
 *
 * lib 이 아니라 여기 사는 것은 소비자가 이 화면 하나라서다(루트 AGENTS.md 「src/lib 잔류 기준」) — 서버는 이
 * 파일을 import 하지 않고 SQL 사본을 쓴다(서버는 features 를 import 할 수 없다).
 */

export interface ShareTargetFacts {
  /** 이번 조건에 맞는가 */
  matched: boolean;
  /** 적용 전 이 링크의 범위에 있는가 */
  inThisLink: boolean;
  /** 적용 전 이 설문의 다른 **열린** 외주 링크 범위에 있는가 — 종료된 링크는 몫이 없다 */
  inOtherOpenLink: boolean;
}

export interface ShareTargetOutcome {
  /** 적용 뒤 이 링크의 범위에 있는가 */
  inThisLink: boolean;
  /** 다른 링크들의 범위에서 빠지는가 */
  leavesOtherLinks: boolean;
}

/** 겹침 — 조건 결과 중 이 링크에 아직 없고 다른 열린 링크에 있는 대상. 이미 같이 맡은 대상은 아니다. */
export function isShareOverlap(t: ShareTargetFacts): boolean {
  return t.matched && !t.inThisLink && t.inOtherOpenLink;
}

export function shareTargetOutcome(
  t: ShareTargetFacts,
  overlap: FieldworkShareOverlap,
): ShareTargetOutcome {
  if (!t.matched) return { inThisLink: false, leavesOtherLinks: false };
  if (!isShareOverlap(t)) return { inThisLink: true, leavesOtherLinks: false };
  switch (overlap) {
    case 'take':
      return { inThisLink: true, leavesOtherLinks: true };
    case 'keep':
      return { inThisLink: false, leavesOtherLinks: false };
    case 'joint':
      return { inThisLink: true, leavesOtherLinks: false };
  }
}

/** 고른 처리로 적용하면 이 링크에 남는 인원 — 남겨 두기만 겹침만큼 적다. */
export function shareCountAfter(
  summary: Pick<FieldworkShareChangeSummary, 'matched' | 'overlap'>,
  overlap: FieldworkShareOverlap,
): number {
  return overlap === 'keep' ? summary.matched - summary.overlap : summary.matched;
}
