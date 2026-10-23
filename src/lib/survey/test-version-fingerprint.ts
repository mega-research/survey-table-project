import type { SurveyVersionFingerprints } from '@/shared/contracts/survey';

/**
 * 테스트 버전 지문 (CONTEXT.md 「테스트 버전」) — 저장본으로 만든 스냅샷이 직전 테스트 버전과 다른지
 * (`revision`), 다르면 어느 문항이 바뀌었는지(문항·그룹 지문)를 가른다.
 *
 * - `revision` 은 스냅샷 전체(제목·설정·LUT·앵커·순서 포함)의 지문이다 — 하나라도 다르면 테스트
 *   버전을 새로 만든다.
 * - 문항·그룹 지문은 **순서(`order`)를 보지 않는다.** 테스트 응답을 옮길 때 「바뀐 문항」으로
 *   데려가는 기준이라, 순서만 바꾼 문항까지 잡으면 뒤 문항이 줄줄이 바뀐 것으로 잡혀 매번 앞으로
 *   끌려간다.
 *
 * 암호학적 해시가 아니다 — 같은 설문의 두 저장본을 가르는 데만 쓴다. 테스트 버전 만들기(survey-builder)와
 * 재개 이관(survey-response) 두 서버 도메인이 쓰는 순수 함수라 lib 에 둔다.
 */

interface SnapshotLike {
  questions?: unknown;
  groups?: unknown;
}

/** 키를 정렬해 직렬화한다 — 같은 구조는 키 순서와 무관하게 같은 문자열이 된다. */
function stableStringify(value: unknown, omitKey?: string): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => key !== omitKey && item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** cyrb53 — 짧고 충돌이 드문 53비트 문자열 해시. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function itemsWithId(value: unknown): Array<Record<string, unknown> & { id: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> & { id: string } =>
      item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
  );
}

function fingerprintItems(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of itemsWithId(value)) out[item.id] = hash(stableStringify(item, 'order'));
  return out;
}

/** 스냅샷의 리비전과 문항·그룹 지문. */
export function buildStructureFingerprints(snapshot: SnapshotLike): SurveyVersionFingerprints {
  return {
    revision: hash(stableStringify(snapshot)),
    questions: fingerprintItems(snapshot.questions),
    groups: fingerprintItems(snapshot.groups),
  };
}

/**
 * 직전 지문 대비 바뀐 문항 id — 지문이 다른 문항, 새로 생긴 문항, 설정이 바뀐 그룹(하위 그룹 포함)의
 * 문항을 새 스냅샷의 문항 순서대로 낸다. 지워진 문항은 데려갈 자리가 없어 내지 않는다.
 * 직전 지문이 없으면(이 기능 이전에 만든 응답) 아무것도 내지 않는다.
 */
export function changedQuestionIds(
  prev: Pick<SurveyVersionFingerprints, 'questions' | 'groups'> | null | undefined,
  next: SnapshotLike,
): string[] {
  if (!prev) return [];
  const nextFp = buildStructureFingerprints(next);
  const groups = itemsWithId(next.groups);

  const changedGroups = new Set(
    groups.filter((group) => prev.groups[group.id] !== nextFp.groups[group.id]).map((g) => g.id),
  );
  // 하위 그룹으로 퍼뜨린다 — 상위 그룹 조건이 바뀌면 하위 페이지가 보이는지도 달라진다.
  let grew = changedGroups.size > 0;
  while (grew) {
    grew = false;
    for (const group of groups) {
      const parent = group['parentGroupId'];
      if (typeof parent === 'string' && changedGroups.has(parent) && !changedGroups.has(group.id)) {
        changedGroups.add(group.id);
        grew = true;
      }
    }
  }

  return itemsWithId(next.questions)
    .filter((question) => {
      if (prev.questions[question.id] !== nextFp.questions[question.id]) return true;
      const groupId = question['groupId'];
      return typeof groupId === 'string' && changedGroups.has(groupId);
    })
    .map((question) => question.id);
}
