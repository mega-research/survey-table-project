import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';

/**
 * 설문 단위 게스트 grant.
 *
 * GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]" — 해당 유저는 grant 된
 * 설문들의 operations 표면에만 접근한다. 같은 userId 를 반복 등재하면 설문
 * 여러 개를 가질 수 있다 (guest1:s1,guest1:s2). admin-allowlist 와 같은
 * 접근제어 인프라 상수.
 *
 * 주의: grant 보유자는 ADMIN_USER_IDS 설정 여부와 무관하게 항상 게스트로
 * 취급된다(canAccessSurvey grant-first). ADMIN_USER_IDS 미설정(fail-open) 이
 * 남기는 리스크는 grant 가 없는 임의 가입자가 admin 취급되는 경우로 한정되며,
 * 이 경우도 allowlist 를 반드시 설정해 막아야 한다.
 */

const ENV_KEY = 'GUEST_SURVEY_GRANTS';

/** 콤마 분리 "userId:surveyId" 목록 파싱 — 같은 userId 는 누적. 형식 불량 항목은 무시. */
export function parseGuestGrants(raw?: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const userId = trimmed.slice(0, sep).trim();
    const surveyId = trimmed.slice(sep + 1).trim();
    if (!userId || !surveyId) continue;
    const list = map.get(userId) ?? [];
    if (!list.includes(surveyId)) list.push(surveyId);
    map.set(userId, list);
  }
  return map;
}

/** 게스트 grant 설문 목록 조회 — 없으면 빈 배열. */
export function getGuestSurveyIds(userId: string): string[] {
  return parseGuestGrants(process.env[ENV_KEY]).get(userId) ?? [];
}

/** 게스트(설문 단위 grant 보유자) 여부. */
export function isGuestUser(userId: string): boolean {
  return getGuestSurveyIds(userId).length > 0;
}

/**
 * admin allowlist 통과 또는 게스트 grant 보유 판정 — 게스트에게 열린 표면
 * (scoped 베이스, 업로드 라우트)의 공용 1차 가드. 설문 일치는 별도로
 * canAccessSurvey/assertSurveyAccess 가 강제한다.
 */
export function isAdminOrGuestGrantHolder(userId: string): boolean {
  return isGuestUser(userId) || isAdminUserAllowed(userId);
}

/** 설문 접근 판정 — grant 보유자는 항상 게스트(grant 설문들만), 그 외는 admin allowlist 판정. */
export function canAccessSurvey(userId: string, surveyId: string): boolean {
  const granted = getGuestSurveyIds(userId);
  if (granted.length > 0) return granted.includes(surveyId);
  return isAdminUserAllowed(userId);
}

/**
 * 보기만 하는 게스트 grant — 이 (계정, 설문) 쌍은 운영 콘솔에서 「실사 현황」의 응답 현황·
 * 응답 내역 목록만 본다. 다른 탭·설문 보기는 메뉴에서 빠지고 경로도 응답 현황으로 돌려보낸다.
 * 응답 현황 안에서는 KPI·쿼터·일자별 추이 차트만 남기고(operations/overview 페이지),
 * 응답 내역에서는 수정·삭제·초기화 메뉴가 없으며 수정 화면 경로와 수정 저장(saveAdminEdit)도
 * 막는다. 응답 내역의 시작일시·소요시간도 이 계정에는 내지 않는다(화면·내려받는 목록 — 2026-11-17). 같은 계정의 다른 grant 설문에는 걸리지 않는다.
 *
 * `allowPreview` 를 켠 grant 는 설문 보기(preview)도 연다 — 설문 내용을 보여 줘도 되는 고객용이다.
 * 끈 grant(guest9)는 협업 업체와 함께 하는 조사라 설문 보기를 막아 둔다.
 *
 * `allowResponseView` 를 켠 grant 는 응답 내역의 행마다 「조회」가 생겨 응답 한 건의 답을 본다
 * (`…/profiles/<응답>/view` — 응답 수정 화면을 잠가 그린 조회 전용 화면). 수정 화면 경로와 수정
 * 저장은 그대로 막힌다. 답은 원문 그대로 보인다(응답자 정보 문항 포함 — 2026-11-16 사용자 결정).
 *
 * `allowExport: 'response-list'` 를 켠 grant 는 응답 현황의 「엑셀 다운로드」로 **응답 내역 목록**
 * (응답 내역 화면의 열 그대로 — 순번·유저ID·기업명·상태 등)을 받는다. 답이 든 Raw·SPSS 는 받지 못한다
 * (2026-11-16 사용자 결정 — 처음엔 가린 Raw 를 열었다가 같은 날 목록만으로 바꿨다). **게스트 계정은 —
 * 보기 전용이든 아니든 — 이 스위치가 허용한 것 말고는 내보내기 주소를 직접 불러도 받지 못한다**
 * (`canExportSurveyData`).
 */
const VIEW_ONLY_GUEST_GRANTS: ReadonlyArray<{
  userId: string;
  surveyId: string;
  allowPreview?: true;
  allowResponseView?: true;
  allowExport?: 'response-list';
}> = [
  // guest9 — 2026년 인공지능산업 실태조사 공개본(리멤버 패널용), 2026-10-22 요청
  {
    userId: 'c79af8a1-186a-4157-be4c-2bebfbde4a8d',
    surveyId: '253534a5-913a-4891-a019-f9643ccea0a7',
    // 응답 내역 목록 엑셀만 받는다 — 답이 든 Raw 는 열지 않는다(2026-11-16 요청)
    allowExport: 'response-list',
  },
  // dairy@ (처음 client1@) — 2026 유가공업 실태조사 고객(클라이언트) 계정, 2026-11-05 요청
  {
    userId: '75060289-51b4-44e7-8fd1-dabf73a0bfaf',
    surveyId: '24b15972-36fe-400a-adfe-7d4c80438204',
    // 설문을 보여 줘도 되는 고객이라 설문 보기를 연다(2026-11-05 요청)
    allowPreview: true,
    // 응답 한 건의 답도 본다 — 조회만(2026-11-16 요청)
    allowResponseView: true,
  },
  // guest11 — 여성기업 실태조사 신규문항(안) 사전 설문조사, 응답 현황·응답 내역만(2026-11-12 요청)
  {
    userId: '6ca037a8-c282-4bbe-af64-f4f147bf5039',
    surveyId: '8f2bc707-5821-4bbb-bc69-fcd7277cd1cb',
  },
  // guest13 — 피지컬 AI 산업·인력 실태조사, guest9 와 같은 권한(2026-11-18 요청)
  {
    userId: '4f3bb82e-ff76-4984-8493-5630be980c58',
    surveyId: '32bbf027-86c7-490b-9178-29b7a7ca35b6',
    allowExport: 'response-list',
  },
];

/** 이 계정이 보기만 하는 grant 설문 목록 — grant 가 없는 설문은 빼고 돌려준다. */
export function getViewOnlySurveyIds(userId: string): string[] {
  const granted = getGuestSurveyIds(userId);
  return VIEW_ONLY_GUEST_GRANTS.filter(
    (g) => g.userId === userId && granted.includes(g.surveyId),
  ).map((g) => g.surveyId);
}

/** 이 계정이 이 설문에서 보기만 하는가. */
export function isViewOnlyGuest(userId: string, surveyId: string): boolean {
  return getViewOnlySurveyIds(userId).includes(surveyId);
}

/** 이 계정이 보기만 하면서도 설문 보기는 여는 grant 설문 목록 — `allowPreview` 를 켠 보기 전용 grant. */
export function getViewOnlyPreviewSurveyIds(userId: string): string[] {
  const viewOnly = getViewOnlySurveyIds(userId);
  return VIEW_ONLY_GUEST_GRANTS.filter(
    (g) => g.userId === userId && g.allowPreview === true && viewOnly.includes(g.surveyId),
  ).map((g) => g.surveyId);
}

/** 보기 전용 게스트가 이 설문의 설문 보기를 열 수 있는가. */
export function canViewOnlyGuestPreview(userId: string, surveyId: string): boolean {
  return getViewOnlyPreviewSurveyIds(userId).includes(surveyId);
}

/** 이 계정이 보기만 하면서도 응답 조회는 여는 grant 설문 목록 — `allowResponseView` 를 켠 보기 전용 grant. */
export function getViewOnlyResponseViewSurveyIds(userId: string): string[] {
  const viewOnly = getViewOnlySurveyIds(userId);
  return VIEW_ONLY_GUEST_GRANTS.filter(
    (g) => g.userId === userId && g.allowResponseView === true && viewOnly.includes(g.surveyId),
  ).map((g) => g.surveyId);
}

/** 보기 전용 게스트가 이 설문의 응답 조회 화면을 열 수 있는가. */
export function canViewOnlyGuestViewResponse(userId: string, surveyId: string): boolean {
  return getViewOnlyResponseViewSurveyIds(userId).includes(surveyId);
}

/**
 * 게스트 담당 범위 — 이 (계정, 설문) 쌍은 **명단의 `attrsKey` 열이 `value` 인 조사 대상**과 그 대상의
 * 응답·회차·메일 이력만 본다. 한 설문을 외주 업체 여럿이 나눠 뛸 때 서로의 명단(연락처)을 가린다
 * (2026-11-19 요청, `.scratch/guest-target-share/PRD.md`).
 *
 * - 범위는 명단 값이라 관리자가 명단 업로드(또는 상세의 값 수정)로 나눈다. 그 열이 비었거나 다른 값인
 *   대상은 이 계정에 보이지 않는다 — 어느 등재에도 안 걸리는 대상은 관리자만 본다.
 * - 등재된 계정(「범위 게스트」)에는 **범위로 거르는 표면만 열린다**. 거르지 않는 표면(단체 메일·내려받기 등)은
 *   procedure(`assertSurveyAccess`)·페이지 가드(`requireSurveyConsolePage`)·미들웨어(`guestPathRedirect`)·
 *   REST 라우트가 닫는다 — 기본 거부.
 * - 범위 게스트는 그 열을 바꾸지 못하고, 추가하는 대상에는 자기 값이 찍힌다(`contact-targets` 서비스).
 * - 술어와 해석은 `server/fieldwork-share-scope` 한 곳이다.
 *
 * staging 의 외주 링크 「담당 범위」(ADR-0035)가 운영에 오르면 이 목록과 함께 걷는다 — 그때까지의 다리다.
 */
const GUEST_TARGET_SHARES: ReadonlyArray<{
  userId: string;
  surveyId: string;
  attrsKey: string;
  value: string;
}> = [
  // from2@ — 피지컬 AI 산업·인력 실태조사 개별링크, 프롬 몫(2026-11-19 요청)
  {
    userId: 'ddcdc638-3cc2-4a84-acd9-204b66b57e28',
    surveyId: '1b88ae5a-257a-40ad-80a4-a6a698fde05a',
    attrsKey: '실사업체',
    value: '프롬',
  },
  // prime2@ — 같은 설문, 프라임 몫(2026-11-19 요청)
  {
    userId: '882ddaa3-f52b-4c7b-8837-0dcffc44575d',
    surveyId: '1b88ae5a-257a-40ad-80a4-a6a698fde05a',
    attrsKey: '실사업체',
    value: '프라임',
  },
];

export interface GuestTargetShare {
  /** 범위를 가르는 명단 일반 열 이름(`attrs` 의 키) */
  attrsKey: string;
  /** 이 계정 몫의 값 — 그 열이 정확히 이 값인 대상만 보인다 */
  value: string;
}

/** 이 계정이 이 설문에서 담당 범위에 묶여 있으면 그 범위, 아니면 null(설문 전체). */
export function getGuestTargetShare(userId: string, surveyId: string): GuestTargetShare | null {
  const hit = GUEST_TARGET_SHARES.find((g) => g.userId === userId && g.surveyId === surveyId);
  return hit ? { attrsKey: hit.attrsKey, value: hit.value } : null;
}

/** 이 계정이 담당 범위에 묶인 grant 설문 목록 — 미들웨어의 경로 판정용. */
export function getShareRestrictedSurveyIds(userId: string): string[] {
  const granted = getGuestSurveyIds(userId);
  return GUEST_TARGET_SHARES.filter(
    (g) => g.userId === userId && granted.includes(g.surveyId),
  ).map((g) => g.surveyId);
}

/** 이 계정이 이 설문에서 담당 범위에 묶인 게스트인가. */
export function isShareRestrictedGuest(userId: string, surveyId: string): boolean {
  return getGuestTargetShare(userId, surveyId) !== null;
}

/**
 * 내려받는 것의 종류 — `response-list` 는 응답 내역 목록(화면의 열 그대로, 답은 없다),
 * `data` 는 답이 든 파일(Raw·분할·SPSS)과 그 미리보기.
 */
export type SurveyExportKind = 'response-list' | 'data';

/**
 * 이 계정이 이 설문에서 그 종류를 내려받을 수 있는가 — 내보내기 주소(export·split-preview)의 판정.
 * 관리자는 설문 접근 판정 그대로 전부, 게스트는 grant 의 `allowExport` 가 허용한 종류만 받는다
 * (지금은 `response-list` 뿐 — 답이 든 파일을 받는 게스트는 없다). 버튼을 숨기는 것만으로는 주소를
 * 직접 부르는 요청을 막지 못한다.
 */
export function canExportSurveyData(
  userId: string,
  surveyId: string,
  kind: SurveyExportKind,
): boolean {
  if (!canAccessSurvey(userId, surveyId)) return false;
  if (!isGuestUser(userId)) return true;
  // 담당 범위에 묶인 게스트 — 내보내기 로더는 범위를 거르지 않으므로 어떤 종류도 내지 않는다
  if (isShareRestrictedGuest(userId, surveyId)) return false;
  return VIEW_ONLY_GUEST_GRANTS.some(
    (g) => g.userId === userId && g.surveyId === surveyId && g.allowExport === kind,
  );
}

/** 게스트가 무권한 설문 URL 을 눌렀을 때 보내는 강제 로그아웃 라우트. */
export const GUEST_FORCE_LOGOUT_PATH = '/admin/logout';

/** 설문 콘솔(operations/preview) 경로에서 설문 id 캡처. */
const SURVEY_CONSOLE_PATH = /^\/admin\/surveys\/([^/]+)\/(?:operations|preview)(?:\/|$)/;

/**
 * 경로가 grant 밖 다른 설문의 콘솔(operations/preview)인지 판정.
 * 로그인 시 "이 계정 담당 설문이 아님" 안내의 근거 — 특정 설문을 향한
 * 접근일 때만 true 고, /admin 등 설문 의도가 없는 경로는 false.
 */
export function isForeignSurveyConsolePath(
  pathname: string,
  grantedSurveyIds: readonly string[],
): boolean {
  const surveyId = SURVEY_CONSOLE_PATH.exec(pathname)?.[1];
  return surveyId !== undefined && !grantedSurveyIds.includes(surveyId);
}

/** 정찰용 가짜 출처 — 경로를 이 출처 기준으로 해석해 출처가 바뀌는지 본다. */
const INTERNAL_PATH_PROBE_ORIGIN = 'http://internal.invalid';

/**
 * open redirect 방지 — 같은 출처 내부 절대경로만 통과, 그 외 null.
 *
 * 문자열 앞머리만 보면 뚫린다: URL 해석은 탭·개행을 지우고 역슬래시를 슬래시로 읽어
 * `/\t/evil.example` 이 `//evil.example` 이 된다(2026-11-05 Codex 리뷰 재현). 그래서 제어문자와
 * 역슬래시를 통째로 거부하고, 실제로 해석해 출처가 그대로인지 한 번 더 본다.
 * 로그인 액션·로그아웃 라우트·미들웨어·requirePageUser 가 모두 이 함수로 거른다.
 */
export function sanitizeInternalPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\u0000-\u001F\u007F\\]/.test(raw)) return null;
  try {
    if (new URL(raw, INTERNAL_PATH_PROBE_ORIGIN).origin !== INTERNAL_PATH_PROBE_ORIGIN) return null;
  } catch {
    return null;
  }
  return raw;
}

/** `<profiles 앞머리><응답 id>/view` 꼴인가 — 응답 id 자리는 한 구간이어야 한다. */
function isResponseViewPath(pathname: string, profilesPrefix: string): boolean {
  if (!pathname.startsWith(profilesPrefix)) return false;
  const [responseId, leaf, ...rest] = pathname.slice(profilesPrefix.length).split('/');
  return !!responseId && leaf === 'view' && rest.length === 0;
}

/**
 * 담당 범위에 묶인 게스트에게 닫는 운영 콘솔 하위 경로 — 그 화면의 조회가 범위를 거르지 않는다.
 * 단체 메일(캠페인·템플릿·위저드), 문항 수요, 이월 응답, 컬럼 설정 둘. 페이지 가드(`requireSurveyConsolePage` 의
 * `share` 정책)와 같은 집합이어야 한다 — `tests/repo/admin-page-guard.test.ts` 가 대조한다.
 */
export const SHARE_RESTRICTED_BLOCKED_SUBPATHS: readonly string[] = [
  'mail',
  'demand',
  'contacts/prior-answers',
  // 컬럼 설정 화면 — 저장 procedure 가 관리자 전용이라 게스트에게는 쓸모가 없고, 범위를 거르는지
  // 따질 화면을 늘리지 않는다.
  'profiles/columns',
  'report/columns',
];

/**
 * 미들웨어용 게스트 경로 판정 (순수 함수).
 * 허용 경로면 null, 차단이면 리다이렉트 목적지 pathname 반환.
 *
 * grant 된 설문들의 operations/preview 는 전부 허용한다. 그 밖의 admin 경로는
 * 설문 콘솔이든 아니든 전부 즉시 로그아웃시켜 로그인 화면으로 보낸다 — 자기
 * 설문으로 조용히 돌리면 실사 인력이 버그·중복 로그인으로 착각하는 문제가
 * 있어, "권한 없는 URL = 로그아웃 + 재로그인" 으로 단일화한 운영 결정
 * (2026-08-18, grant 설문 안의 차단 편집 화면만 예외로 해당 overview 복귀).
 */
export function guestPathRedirect(
  pathname: string,
  grantedSurveyIds: readonly string[],
  viewOnlySurveyIds: readonly string[] = [],
  viewOnlyPreviewSurveyIds: readonly string[] = [],
  viewOnlyResponseViewSurveyIds: readonly string[] = [],
  shareRestrictedSurveyIds: readonly string[] = [],
): string | null {
  if (pathname === '/admin/login') return null;
  // 강제 로그아웃 라우트 자신은 통과 — 리다이렉트 루프 방지.
  if (pathname === GUEST_FORCE_LOGOUT_PATH) return null;
  for (const grantedSurveyId of grantedSurveyIds) {
    // 설문 보기(발행 스냅샷 미리보기)는 읽기 전용 화면이라 게스트에게도 허용한다.
    const previewPath = `/admin/surveys/${grantedSurveyId}/preview`;
    const allowedPrefix = `/admin/surveys/${grantedSurveyId}/operations`;
    const overviewPath = `${allowedPrefix}/overview`;
    // 보기만 하는 grant — 응답 현황과 응답 내역 목록만 열고, 그 밖의 콘솔 화면(응답 수정
    // 화면·컬럼 설정 포함)과 설문 보기는 응답 현황으로 돌려보낸다. 설문 보기를 허용한 grant 는 설문 보기만,
    // 응답 조회를 허용한 grant 는 응답 조회 화면(`profiles/<응답>/view`)만 더 연다 — 수정 화면은 열지 않는다.
    if (viewOnlySurveyIds.includes(grantedSurveyId)) {
      if (pathname === overviewPath || pathname.startsWith(`${overviewPath}/`)) return null;
      if (pathname === `${allowedPrefix}/profiles`) return null;
      if (pathname === previewPath && viewOnlyPreviewSurveyIds.includes(grantedSurveyId)) {
        return null;
      }
      if (
        viewOnlyResponseViewSurveyIds.includes(grantedSurveyId) &&
        isResponseViewPath(pathname, `${allowedPrefix}/profiles/`)
      ) {
        return null;
      }
      if (
        pathname === previewPath ||
        pathname.startsWith(`${previewPath}/`) ||
        pathname === allowedPrefix ||
        pathname.startsWith(`${allowedPrefix}/`)
      ) {
        return overviewPath;
      }
      continue;
    }
    if (pathname === previewPath || pathname.startsWith(`${previewPath}/`)) return null;
    if (pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`)) {
      // 액션 procedure 가 authed(게스트 차단)로 남는 편집 화면은 경로도 함께 차단 —
      // 폼을 다 채운 뒤 FORBIDDEN 을 받는 반쪽 UI 를 만들지 않는다.
      // (컨택 목록·상세·수동 추가·메일·profiles 는 게스트 허용 procedure 와 짝이라 통과.)
      const blockedSubpaths = [
        'contacts/upload',
        'contacts/result-codes',
        'contacts/columns',
        // 컨택원 관리 — 내부 실사 운영 도구라 게스트에게 열지 않는다(procedure 도 authed).
        'contacts/assignments',
        'quota',
        // 척도 평균 — 내부 담당자용 집계(발주처 공개는 별도 결정, CONTEXT.md 「척도 평균」).
        'scale-mean',
      ];
      // 담당 범위에 묶인 게스트 — 범위로 거르지 않는 화면을 더 닫는다(GUEST_TARGET_SHARES).
      if (shareRestrictedSurveyIds.includes(grantedSurveyId)) {
        blockedSubpaths.push(...SHARE_RESTRICTED_BLOCKED_SUBPATHS);
      }
      for (const sub of blockedSubpaths) {
        const full = `${allowedPrefix}/${sub}`;
        if (pathname === full || pathname.startsWith(`${full}/`)) {
          return overviewPath;
        }
      }
      return null;
    }
  }
  // grant 밖 경로 전부 — 즉시 로그아웃 (grant 설문 경로는 위에서 이미 통과/차단됨)
  return GUEST_FORCE_LOGOUT_PATH;
}

/**
 * 게스트 로그인 직후 목적지 해석 (순수 함수). target 은 로그인 폼의 redirect
 * 파라미터를 resolveRedirect 로 정제한 내부 경로(쿼리 포함 가능).
 *
 * 자기 설문의 허용 경로면 그대로 복귀시키고, 그 외(무권한 설문·기본 목적지
 * /admin/surveys 등)는 첫 grant 설문 overview 로 보낸다 — guestPathRedirect
 * 폴백이 강제 로그아웃이라 여기서 걸러주지 않으면 로그인 직후 다시 로그아웃
 * 되는 루프가 된다.
 */
export function guestPostLoginRedirect(
  target: string,
  grantedSurveyIds: readonly string[],
  viewOnlySurveyIds: readonly string[] = [],
  viewOnlyPreviewSurveyIds: readonly string[] = [],
  viewOnlyResponseViewSurveyIds: readonly string[] = [],
  shareRestrictedSurveyIds: readonly string[] = [],
): string {
  const path = target.split(/[?#]/)[0] ?? target;
  const dest = guestPathRedirect(
    path,
    grantedSurveyIds,
    viewOnlySurveyIds,
    viewOnlyPreviewSurveyIds,
    viewOnlyResponseViewSurveyIds,
    shareRestrictedSurveyIds,
  );
  // 허용 경로 — 단 로그인·로그아웃 라우트는 로그인 직후 목적지로 무의미
  if (dest === null && path !== '/admin/login' && path !== GUEST_FORCE_LOGOUT_PATH) {
    return target;
  }
  // grant 설문 안의 차단 편집 화면 — 해당 설문 overview 로
  if (dest !== null && dest !== GUEST_FORCE_LOGOUT_PATH) return dest;
  return `/admin/surveys/${grantedSurveyIds[0]}/operations/overview`;
}
