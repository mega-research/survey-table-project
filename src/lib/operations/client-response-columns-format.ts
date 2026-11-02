// 클라이언트 링크 응답 내역의 열 — 허용 판정과 후보 목록 (`.scratch/client-link-response-list` 티켓 04).
// 순수 계산이라 server-only 금지. DB 를 읽는 쪽은 server/read-models/client-response-columns.
import type { NormalizedContactColumnScheme } from '@/lib/operations/contacts-format';
import {
  PROFILE_SYS_COLUMNS,
  answerKeyOf,
  entryKeyOf,
  hydrateProfileColumns,
} from '@/lib/operations/profile-columns-format';
import type { ProfileColumnScheme } from '@/shared/contracts/operations';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';
import { CLIENT_RESPONSE_FIRST_COLUMN_KEY } from '@/shared/contracts/workspace';

const ATTRS_PREFIX = 'attrs.';

/**
 * IP 해시는 클라이언트에게 내지 않는다 — 앞 8자만 보여도 같은 IP 의 응답을 엮는 식별자다.
 * 나머지 시스템 열은 응답 행의 메타라 고를 수 있다.
 */
const BLOCKED_SYS_KEYS: ReadonlySet<string> = new Set(['sys.ipHash']);

/** 고를 수 있는 시스템 열 — 내부 응답 내역의 시스템 열 순서 그대로. */
export const CLIENT_RESPONSE_SYS_KEYS: readonly string[] = PROFILE_SYS_COLUMNS.map(
  (c) => c.key,
).filter((key) => !BLOCKED_SYS_KEYS.has(key));

/** 허용 판정의 재료 — 지금 설문 구조에서 열 수 있는 것들. */
export interface ClientResponseColumnSources {
  /** 명단 컬럼 스킴의 `attrs.*` 열 중 개인정보로 매핑하지 않은 것. */
  attrsKeys: ReadonlySet<string>;
  /** 종료 후 이동 주소 설정의 이어 넘길 값 이름(euid 등). */
  entryNames: ReadonlySet<string>;
  /** 응답값 열 후보 — 암호화 저장 여부까지. */
  answerSources: ReadonlyArray<Pick<ProfileAnswerSource, 'key' | 'encrypted'>>;
}

/**
 * 이 열 키를 클라이언트에게 보여도 되는가 — **쓰기와 읽기가 함께 부르는 한 함수**다.
 *
 * | 원천 | 허용 | 이유 |
 * | --- | --- | --- |
 * | `sys.*` (IP 해시 제외) | O | 응답 행 메타 |
 * | `sys.ipHash` | X | 같은 IP 의 응답을 엮는 식별자 |
 * | `entry.<name>` | O | 리멤버가 준 값을 리멤버에게 돌려준다(이 기능의 핵심 열) |
 * | `attrs.<key>` | O | 개인정보로 매핑하지 않은 명단 열 — 업로드 시점 결정이 개인정보의 정의다 |
 * | `pii.<key>` | X | 평문 개인정보. 마스킹본도 내지 않는다 |
 * | `answer.*` 암호화 칸 | X | 개인정보 문항 |
 * | `answer.*` 평문 칸 | O | 단답·장문·표 입력 칸 |
 *
 * 지금 구조에 없는 키(지운 문항·지운 이어 넘길 값·지운 명단 열)도 거부한다. 판정을 열거된 허용
 * 목록으로만 하므로 새 접두가 생겨도 여기에 적기 전까지는 닫혀 있다.
 */
export function isClientResponseColumnAllowed(
  key: string,
  sources: ClientResponseColumnSources,
): boolean {
  if (CLIENT_RESPONSE_SYS_KEYS.includes(key)) return true;
  const entryName = entryKeyOf(key);
  if (entryName !== null) return sources.entryNames.has(entryName);
  if (key.startsWith(ATTRS_PREFIX)) return sources.attrsKeys.has(key);
  if (answerKeyOf(key) !== null) {
    const source = sources.answerSources.find((s) => s.key === key);
    return source !== undefined && !source.encrypted;
  }
  return false;
}

/**
 * 저장된 키 → 지금 그릴 열. 허용 밖·지금 구조에 없는 키는 **버리고** 버린 것을 돌려준다(호출자가
 * 경고 로그를 남긴다). 순번은 언제나 맨 앞이다.
 *
 * 쓰기 경로가 이미 거른 키라도 다시 거르는 이유는 드리프트다 — 저장 뒤에 문항이 지워지거나
 * 암호화로 바뀌거나, 누가 행을 손으로 고칠 수 있다. 읽기가 마지막 그물이다.
 */
export function resolveClientResponseColumnKeys(
  saved: readonly string[],
  sources: ClientResponseColumnSources,
): { keys: string[]; dropped: string[] } {
  const keys = [CLIENT_RESPONSE_FIRST_COLUMN_KEY];
  const dropped: string[] = [];
  for (const key of saved) {
    if (key === CLIENT_RESPONSE_FIRST_COLUMN_KEY || keys.includes(key)) continue;
    if (isClientResponseColumnAllowed(key, sources)) keys.push(key);
    else dropped.push(key);
  }
  return { keys, dropped };
}

export type ClientResponseColumnKind = 'sys' | 'entry' | 'attrs' | 'answer';

export interface ClientResponseColumnCandidate {
  key: string;
  /** 표 머리에 나갈 이름 — 내부 응답 내역의 라벨. */
  label: string;
  kind: ClientResponseColumnKind;
  /** 응답값 열이면 내보내기 변수명 — 고르는 화면이 같은 이름의 칸을 갈라 보인다. */
  varName?: string;
}

/**
 * 고르는 화면의 후보 목록 겸 라벨 사전 — 순서는 시스템 → 이어 넘길 값 → 명단 → 응답값.
 *
 * 라벨은 내부 응답 내역의 것을 쓴다(`hydrateProfileColumns`). 연구원이 내부에서 고친 이름이
 * 클라이언트에게도 간다. 내부 설정에 아직 없는 응답값 열은 내부 「응답값 추가」가 처음 붙이는
 * 이름(칸 이름 → 문항 제목 → 변수명)을 쓴다.
 *
 * 시스템ID 는 조사 대상이 있는 설문에서만 후보다 — 내부 표·엑셀 내보내기와 같은 규칙.
 */
export function buildClientResponseColumnCandidates(input: {
  contactScheme: NormalizedContactColumnScheme | null;
  profileScheme: ProfileColumnScheme | null;
  entryParamNames: readonly string[];
  answerSources: readonly ProfileAnswerSource[];
  hasContacts: boolean;
}): ClientResponseColumnCandidate[] {
  const sources = clientResponseColumnSources(input);
  const labels = new Map(
    hydrateProfileColumns(
      input.contactScheme,
      input.profileScheme,
      input.entryParamNames,
      new Set(input.answerSources.map((s) => s.key)),
    ).map((c) => [c.key, c.label]),
  );
  const labelOf = (key: string, fallback: string) => labels.get(key)?.trim() || fallback;

  const out: ClientResponseColumnCandidate[] = [];
  for (const key of CLIENT_RESPONSE_SYS_KEYS) {
    if (key === 'sys.resid' && !input.hasContacts) continue;
    out.push({ key, label: labelOf(key, key), kind: 'sys' });
  }
  for (const name of input.entryParamNames) {
    const key = `entry.${name}`;
    if (sources.entryNames.has(name)) out.push({ key, label: labelOf(key, name), kind: 'entry' });
  }
  const attrsColumns = (input.contactScheme?.columns ?? [])
    .filter((c) => sources.attrsKeys.has(c.source))
    .slice()
    .sort((a, b) => a.order - b.order);
  for (const c of attrsColumns) {
    out.push({ key: c.source, label: labelOf(c.source, c.label), kind: 'attrs' });
  }
  for (const s of input.answerSources) {
    if (!isClientResponseColumnAllowed(s.key, sources)) continue;
    const fallback = (s.cellLabel ?? s.questionTitle).trim() || s.varName;
    out.push({ key: s.key, label: labelOf(s.key, fallback), kind: 'answer', varName: s.varName });
  }
  return out;
}

/** 스킴·설정 → 허용 판정의 재료. 후보 목록과 읽기·쓰기가 같은 재료를 본다. */
export function clientResponseColumnSources(input: {
  contactScheme: NormalizedContactColumnScheme | null;
  entryParamNames: readonly string[];
  answerSources: readonly ProfileAnswerSource[];
}): ClientResponseColumnSources {
  return {
    // 개인정보로 매핑된 열은 `pii.*` 로 저장된다. attrs 쪽에 개인정보 유형이 붙은 열이 있다면
    // 그것도 뺀다 — 넓어지는 쪽으로 틀리지 않게.
    attrsKeys: new Set(
      (input.contactScheme?.columns ?? [])
        .filter((c) => c.source.startsWith(ATTRS_PREFIX) && !c.piiType)
        .map((c) => c.source),
    ),
    entryNames: new Set(input.entryParamNames),
    answerSources: input.answerSources,
  };
}
