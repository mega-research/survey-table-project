/**
 * R2 키 추출·정규화·3중 게이트 — 유예 삭제 시스템의 공용 순수 모듈.
 * 수집(엔티티 삭제·저장 diff)과 집행(전역 참조 재확인)이 반드시 이 모듈을
 * 함께 사용한다 — 수집과 재확인의 판정이 갈리면 안전성이 깨진다.
 * (CONTEXT.md "파일(R2) 수명주기", docs/adr/0001 참조)
 *
 * 3중 게이트 (features/media 의 ALLOWED_IMAGE_KEY_PREFIXES 와 대칭):
 * 1. URL 유래 키는 known R2 host 에서 온 것만 수락 — 외부 도메인(cell.videoUrl
 *    외부 링크, 메일 본문 외부 img)·data: URI·파싱 불가 입력은 키가 아니다.
 * 2. 영구 네임스페이스 화이트리스트 소속만 수락.
 * 3. tmp/* 거부 — tmp 는 R2 lifecycle(24h) 소관으로 이 시스템 밖.
 */

/** 영구 키 네임스페이스 화이트리스트. 신규 네임스페이스 도입 시 여기에 추가. */
export const PERMANENT_KEY_NAMESPACES = [
  'survey/',
  'mail/',
  'mail-attachment/',
  'notice-attachment/',
] as const;

/**
 * known R2 host 정적 목록 — 2026-07-30 실DB 17개 콘텐츠 컬럼 전수 조사로 확정.
 * - cdn-dev.megaresearch.co.kr: 현행 CLOUDFLARE_R2_PUBLIC_URL 호스트
 * - cdn.dev.megaresearch.co.kr: 역대 점 표기 변형 (mail/ 키 서빙 이력)
 * - 4d43...r2.cloudflarestorage.com: 역대 원시 endpoint (경로가 images/* 라
 *   영구 네임스페이스 게이트에서 자연 거부됨 — 참조 재확인에서만 의미)
 * svybx.kr·woodsurvey.kr 등은 외부 링크 도메인으로 조사에서 R2 아님이 확인됨.
 */
export const KNOWN_R2_HOSTS_STATIC = [
  'cdn-dev.megaresearch.co.kr',
  'cdn.dev.megaresearch.co.kr',
  '4d4323ede9dcdd6083ada9e2f0f89468.r2.cloudflarestorage.com',
] as const;

/** 정적 목록 + 런타임 env(CLOUDFLARE_R2_PUBLIC_URL) 호스트의 합집합. */
export function getKnownR2Hosts(): string[] {
  const hosts = new Set<string>(KNOWN_R2_HOSTS_STATIC);
  const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).hostname);
    } catch {
      // 프로토콜 누락 등 비정상 env 값이면 정적 목록만 사용 (r2-env.ts 가 별도 검증)
    }
  }
  return [...hosts];
}

export interface KeyGateOptions {
  /** 미지정 시 getKnownR2Hosts(). 테스트에서 env 독립을 위해 주입 가능. */
  hosts?: readonly string[];
}

function resolveHosts(options?: KeyGateOptions): readonly string[] {
  return options?.hosts ?? getKnownR2Hosts();
}

/**
 * bare 키에 게이트 2·3 + traversal 검사를 적용한다.
 * 통과하면 키 그대로, 아니면 null.
 */
export function gateR2Key(raw: string): string | null {
  if (!raw) return null;
  if (/[\s<\\]/.test(raw)) return null;
  if (raw.startsWith('/')) return null;
  if (raw.includes('..') || raw.includes('//')) return null;
  if (raw.startsWith('tmp/')) return null;
  if (!PERMANENT_KEY_NAMESPACES.some((ns) => raw.startsWith(ns))) return null;
  return raw;
}

/**
 * URL 을 3중 게이트를 거쳐 R2 키로 정규화한다. 게이트 불통과·비 URL 은 null.
 * query·hash 는 키가 아니므로 제거된다.
 */
export function normalizeUrlToR2Key(url: string, options?: KeyGateOptions): string | null {
  if (!url || url.startsWith('data:')) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!resolveHosts(options).includes(parsed.hostname)) return null;
  let pathname = parsed.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // 퍼센트 인코딩이 깨진 경로는 원문 그대로 게이트에 넘긴다
  }
  return gateR2Key(pathname.replace(/^\//, ''));
}

/** 최소 HTML 엔티티 해제 — DB 콘텐츠에 실존하는 형태(&amp; 등)만 다룬다. */
function decodeHtmlEntities(html: string): string {
  return html
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DATA_KEY_ATTR_RE = /\bdata-key=["']([^"']+)["']/g;

/**
 * HTML(또는 임의 문자열)에서 R2 키를 추출한다.
 * img src 한정이 아니라 known host 문자열 전체 스캔이다 — data-link-bands
 * (파이프 구분 밴드 URL), 공지 첨부 href, style url() 등을 모두 잡는다.
 * 공지 첨부의 data-key 속성(bare 키)도 함께 추출한다.
 */
export function extractR2KeysFromHtml(html: string, options?: KeyGateOptions): string[] {
  if (!html) return [];
  const hosts = resolveHosts(options);
  if (hosts.length === 0) return [];
  const decoded = decodeHtmlEntities(html);
  const keys = new Set<string>();

  const urlRe = new RegExp(
    `https?://(?:${hosts.map(escapeRegExp).join('|')})/[^\\s"'<>|\\\\()]*`,
    'g',
  );
  for (const match of decoded.matchAll(urlRe)) {
    const key = normalizeUrlToR2Key(match[0], options);
    if (key) keys.add(key);
  }

  for (const match of decoded.matchAll(DATA_KEY_ATTR_RE)) {
    const key = gateR2Key(match[1] ?? '');
    if (key) keys.add(key);
  }

  return [...keys];
}

/**
 * JSONB 값(질문 행·attachments 배열·응답 헤더 등)을 재귀 순회하며 R2 키를
 * 추출한다. 문자열은 host 스캔 + bare 키 판정(attachments.key, data-key 값
 * 같은 필드) 양쪽을 거친다.
 */
export function extractR2KeysFromJsonbValue(value: unknown, options?: KeyGateOptions): string[] {
  const keys = new Set<string>();
  walkJsonb(value, options, keys);
  return [...keys];
}

function walkJsonb(value: unknown, options: KeyGateOptions | undefined, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    for (const key of extractR2KeysFromHtml(value, options)) out.add(key);
    const bare = gateR2Key(value);
    if (bare) out.add(bare);
    return;
  }
  if (typeof value !== 'object') return;
  if (value instanceof Date) return;
  if (Array.isArray(value)) {
    for (const item of value) walkJsonb(item, options, out);
    return;
  }
  for (const v of Object.values(value)) walkJsonb(v, options, out);
}

/**
 * 저장 diff 계약: 비교는 payload 에 존재하는 필드 집합에 한정한다 — 부분
 * update 경로에서 미포함 필드를 "빠짐"으로 오판하지 않는다. 필드값
 * undefined 는 부재로, null 은 제거로 취급한다.
 */
export function collectRemovedR2Keys(
  oldRow: Record<string, unknown>,
  payloadRow: Record<string, unknown>,
  options?: KeyGateOptions,
): string[] {
  const fields = Object.keys(payloadRow).filter((k) => payloadRow[k] !== undefined);
  if (fields.length === 0) return [];
  const oldKeys = new Set<string>();
  const newKeys = new Set<string>();
  for (const field of fields) {
    walkJsonb(oldRow[field], options, oldKeys);
    walkJsonb(payloadRow[field], options, newKeys);
  }
  return [...oldKeys].filter((k) => !newKeys.has(k));
}

/** 두 키 집합의 차집합 — 기존에 있고 새 버전에 없는 키 (중복 제거). */
export function diffRemovedR2Keys(oldKeys: string[], newKeys: string[]): string[] {
  const newSet = new Set(newKeys);
  return [...new Set(oldKeys.filter((k) => !newSet.has(k)))];
}

/**
 * 메일 콘텐츠(bodyHtml + attachments)에서 키를 추출한다 — 발송 장부 기록과
 * 템플릿 수집원이 공용. attachments 의 key 는 bare 키로 게이트를 거친다.
 */
export function extractMailContentKeys(
  content: {
    bodyHtml?: string | null;
    attachments?: unknown;
  },
  options?: KeyGateOptions,
): string[] {
  const keys = new Set<string>();
  if (content.bodyHtml) {
    for (const key of extractR2KeysFromHtml(content.bodyHtml, options)) keys.add(key);
  }
  if (content.attachments) {
    walkJsonb(content.attachments, options, keys);
  }
  return [...keys];
}
