import { nanoid } from 'nanoid';
import { z } from 'zod';

import {
  ACCESS_LINK_TOKEN_MAX_LENGTH,
  ACCESS_LINK_TOKEN_MIN_LENGTH,
  accessLinkKindValues,
  clientLinkTabValues,
} from '@/shared/contracts/workspace';

/**
 * 외주 실사 링크의 순수 규칙 — 주소 토큰과 공유 비밀번호 (ADR-0026).
 *
 * 값을 만드는 자리를 도메인에 두는 이유는 규칙이 정책이기 때문이다: 토큰 길이는 추측 저항이고,
 * 비밀번호 문자셋은 「사람이 받아 적어 구두로 전달한다」는 전달 방식이 정한다.
 */

/**
 * 주소에 실리는 토큰.
 *
 * 길이는 계약(`ACCESS_LINK_TOKEN_MIN_LENGTH`)이 정한다 — 발번이 하한보다 짧은 값을 만들면
 * 코덱의 모양 검증이 자기가 발급한 토큰을 거부한다. nanoid 의 기본 문자셋은 URL-safe 라 주소에
 * 그대로 실리고 코덱의 정규식과도 맞는다.
 *
 * 초대 코드(`generateInviteCode`, 10자)보다 긴 것은 노출 반경이 다르기 때문이다. 초대 코드는
 * 대상 한 명의 응답 링크지만 이 토큰은 **설문 전체의 조사 대상 명단**으로 가는 문이고, 비밀번호
 * 화면 앞이라도 추측당해서 좋을 것이 없다.
 */
export function generateAccessLinkToken(): string {
  return nanoid(ACCESS_LINK_TOKEN_MIN_LENGTH);
}

/**
 * 공유 비밀번호의 문자셋 — 혼동 문자를 뺀다.
 *
 * `0 O o 1 l I` 를 제외한 것은 이 값이 **전화로 읽어 주는 값**이기 때문이다. 대문자·소문자·숫자를
 * 섞되 읽어서 옮겨 적을 수 있어야 하고, 특수문자는 넣지 않는다(구두 전달과 자판 배열에서 흔들린다).
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 자동 생성 비밀번호의 길이 — 읽어 주기 부담과 추측 저항의 타협점. */
const GENERATED_PASSWORD_LENGTH = 10;

/** 사람이 직접 입력할 때의 최소 길이. 경계 스키마가 같은 값을 강제한다. */
export const ACCESS_LINK_PASSWORD_MIN_LENGTH = 8;

/**
 * 읽어 주기 쉬운 공유 비밀번호를 만든다.
 *
 * `crypto.getRandomValues` 를 쓰고 modulo 편향을 버림으로 없앤다 — 짧은 공유 암호라 편향이
 * 실질 위험은 아니지만, 난수 품질을 낮추는 코드를 남겨 두면 다음 사람이 그것을 선례로 삼는다.
 */
export function generateAccessLinkPassword(): string {
  const size = PASSWORD_ALPHABET.length;
  // 256 을 문자셋 크기로 나눈 나머지 구간은 버린다 — 그 구간을 쓰면 앞쪽 문자가 더 자주 나온다.
  const limit = Math.floor(256 / size) * size;
  const out: string[] = [];
  while (out.length < GENERATED_PASSWORD_LENGTH) {
    const bytes = new Uint8Array(GENERATED_PASSWORD_LENGTH);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(PASSWORD_ALPHABET[byte % size]!);
      if (out.length === GENERATED_PASSWORD_LENGTH) break;
    }
  }
  return out.join('');
}

/**
 * 사람이 입력한 비밀번호의 정돈 — 앞뒤 공백을 버린다.
 *
 * 붙여넣기에서 따라오는 공백 하나가 「맞는데 안 들어가는」 비밀번호를 만든다. 가운데 공백은
 * 그대로 둔다(일부러 넣은 구분일 수 있다).
 */
export function normalizeAccessLinkPassword(raw: string): string {
  return raw.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// 경계 스키마 · 도메인 에러
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 비밀번호 입력 칸 — 비우면 서버가 만든다.
 *
 * `.trim()` 이 스키마에 있는 것이 계약이다: 붙여넣기에 딸려온 공백 하나가 「맞는데 안 들어가는」
 * 비밀번호를 만들고, 화면과 서버가 같은 규칙을 봐야 한다(팀 해산 확인 문구와 같은 선례).
 */
const PasswordField = z
  .string()
  .trim()
  .min(ACCESS_LINK_PASSWORD_MIN_LENGTH, `비밀번호는 ${ACCESS_LINK_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)
  .max(64, '비밀번호는 64자까지 가능합니다.');

/**
 * 어느 링크인가 — 관리 표면이 **한 벌**이라 종류를 입력으로 받는다 (ADR-0029).
 *
 * 종류에 기본값을 두지 않는 것이 계약이다. 한 설문에 외주 링크와 클라이언트 링크가 함께 서므로
 * 종류를 빠뜨린 요청이 어느 한쪽으로 접히면, 클라이언트 패널에서 누른 「종료」가 외주 링크를
 * 닫는다 — 권한은 같아서(둘 다 `survey.manageAccess`) 아무 관문도 그것을 막아 주지 않는다.
 */
const KindField = z.enum(accessLinkKindValues);

export const SurveyAccessLinkInput = z.object({ surveyId: z.uuid(), kind: KindField });
export type SurveyAccessLinkInput = z.infer<typeof SurveyAccessLinkInput>;

/** 발급. 비밀번호를 생략하면 읽어 주기 쉬운 값을 서버가 만든다. */
export const IssueAccessLinkInput = z.object({
  surveyId: z.uuid(),
  kind: KindField,
  password: PasswordField.optional(),
});
export type IssueAccessLinkInput = z.infer<typeof IssueAccessLinkInput>;

/** 비밀번호 재설정 — 토큰은 건드리지 않는다(주소는 영구 고정이다). */
export const ResetAccessLinkPasswordInput = IssueAccessLinkInput;
export type ResetAccessLinkPasswordInput = z.infer<typeof ResetAccessLinkPasswordInput>;

/**
 * 클라이언트 링크의 현황 탭 저장 — **종류를 받지 않는다.**
 *
 * 탭은 클라이언트 링크의 축이다. 외주 콘솔에는 설문마다 고르는 화면이 없어(탭이 고정이다)
 * 종류를 입력으로 열어 두면 「외주 링크에 탭을 저장했는데 아무 일도 없는」 요청이 생긴다 —
 * 표면 자체를 한 종류로 못 박는다. DB 의 CHECK 도 같은 사실을 지킨다(0134).
 *
 * ## 칩 하나와 그 값만 받는다 — 네 값을 통째로 받지 않는다
 *
 * 통째로 받으면 **화면이 낡은 사람의 저장이 남의 변경을 되돌린다.** 두 연구원이 초대 모달을
 * 열어 둔 채 A 가 「조사 대상」을 끄고 B 가 「쿼터 현황」을 켜면, B 의 화면에 남아 있던
 * `조사 대상=true` 가 함께 실려 와 A 가 닫은 화면이 고객사에게 다시 열린다. 넓어지는 쪽으로
 * 조용히 틀린다. 처음에는 반대로 적혀 있었다(「일부만 받으면 한쪽의 저장이 다른 쪽을
 * 되돌린다」) — 틀린 추론이었고 2026-10-12 리뷰가 잡았다. 요청이 말하는 것이 「이 칩을 이
 * 값으로」뿐이면 요청자가 모르는 칩은 요청에 실릴 길이 없다.
 *
 * `enabled` 를 토글이 아니라 **값**으로 받는 것도 같은 이유다. 「뒤집어라」는 지금 값을
 * 전제하므로 낡은 화면에서 누르면 뜻이 반대가 된다 — 꺼진 줄 알고 켜려던 것이 끄기가 된다.
 *
 * 옛 게스트 계정의 탭 저장(`workspace.guests`)은 통째로 받는 모양 그대로다. 그 화면은 입구가
 * 닫혀 있고(ADR-0029) 철거 대상이라 고치지 않았다 — 되살린다면 같은 문제를 그대로 갖는다.
 */
export const SetClientLinkTabInput = z.object({
  surveyId: z.uuid(),
  tab: z.enum(clientLinkTabValues),
  enabled: z.boolean(),
});
export type SetClientLinkTabInput = z.infer<typeof SetClientLinkTabInput>;

/**
 * 링크 세션 표면의 입력 — **외주가 보내는 것**이라 두 칸이 전부다.
 *
 * `linkId`·`surveyId` 를 받지 않는 것이 계약이다. 화면이 그 값을 실어 보낼 수 있으면 누구든
 * 남의 링크 세션을 주장하고, 그 주장이 그대로 귀속에 찍힌다(server/access-link 주석).
 * 토큰의 모양 검증은 판정 코어의 `isAccessLinkToken` 이 한다 — 여기서 정규식을 복제하면
 * 한쪽만 고쳐졌을 때 「경계는 통과했는데 코어가 모르는」 토큰이 생긴다.
 *
 * 비밀번호 칸에 최소 길이를 걸지 않는 것도 의도다. 검증 실패는 언제나 같은 `denied` 여야
 * 하는데, 하한을 걸면 짧은 입력만 BAD_REQUEST 로 갈려 응답이 두 갈래가 된다.
 *
 * 길이 **상한만은** 경계가 진다 — 코어에 닿기 전에 rate limit 키·로그로 흘러갈 수 있어서다.
 * 값은 계약(shared/contracts/workspace)이 소유한다 — 코덱의 정규식도 같은 상수를 본다.
 */
const TokenField = z.string().min(1).max(ACCESS_LINK_TOKEN_MAX_LENGTH);

export const AccessLinkAuthInput = z.object({
  token: TokenField,
  password: z.string().min(1).max(200),
});
export type AccessLinkAuthInput = z.infer<typeof AccessLinkAuthInput>;

/** 나가기 — 그 링크의 쿠키 하나만 지운다(다른 설문 링크는 살아 있다). */
export const AccessLinkSignOutInput = z.object({ token: TokenField });
export type AccessLinkSignOutInput = z.infer<typeof AccessLinkSignOutInput>;

export class AccessLinkNotFoundError extends Error {
  constructor() {
    super('이 설문에는 발급된 링크가 없습니다.');
    this.name = 'AccessLinkNotFoundError';
  }
}

export class AccessLinkAlreadyIssuedError extends Error {
  constructor() {
    super('이 설문에는 이미 발급된 링크가 있습니다.');
    this.name = 'AccessLinkAlreadyIssuedError';
  }
}
