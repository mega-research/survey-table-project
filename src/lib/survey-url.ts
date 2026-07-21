/**
 * 설문 URL 관련 유틸리티 함수들
 * - 공개 설문: 사용자 정의 슬러그 또는 제목에서 자동 생성
 * - 비공개 설문: UUID v4 토큰
 */

// 시스템 예약어 목록 (URL 충돌 방지)
const RESERVED_SLUGS = [
  'admin',
  'api',
  'create',
  'edit',
  'delete',
  'new',
  'settings',
  'analytics',
  'responses',
  'preview',
  'test',
  'login',
  'logout',
  'signup',
  'register',
  'auth',
  'oauth',
  'callback',
  'webhook',
  'health',
  'status',
  'static',
  'assets',
  'public',
  'private',
  '_next',
  'favicon',
  'robots',
  'sitemap',
  'manifest',
];

/**
 * 한글/영문 제목을 URL-safe 슬러그로 변환
 * @param title 설문 제목
 * @returns URL-safe 슬러그
 */
export function generateSlugFromTitle(title: string): string {
  if (!title || title.trim() === '') {
    return '';
  }

  return (
    title
      .toLowerCase()
      .trim()
      // 공백을 하이픈으로 변환
      .replace(/\s+/g, '-')
      // 한글, 영문, 숫자, 하이픈만 유지 (특수문자 제거)
      .replace(/[^\w\u3131-\u3163\uac00-\ud7a3-]/g, '')
      // 연속 하이픈을 단일 하이픈으로
      .replace(/-+/g, '-')
      // 앞뒤 하이픈 제거
      .replace(/^-|-$/g, '')
      // 최대 50자로 제한
      .slice(0, 50)
  );
}

/**
 * 슬러그 유효성 검사
 * @param slug 검사할 슬러그
 * @returns 유효성 검사 결과 객체
 */
export function validateSlug(slug: string): {
  isValid: boolean;
  error?: string;
} {
  // 빈 문자열 체크
  if (!slug || slug.trim() === '') {
    return { isValid: false, error: 'URL 슬러그를 입력해주세요.' };
  }

  // 최소 길이 체크 (3자 이상)
  if (slug.length < 3) {
    return { isValid: false, error: 'URL 슬러그는 최소 3자 이상이어야 합니다.' };
  }

  // 최대 길이 체크 (50자 이하)
  if (slug.length > 50) {
    return { isValid: false, error: 'URL 슬러그는 최대 50자까지 가능합니다.' };
  }

  // 허용 문자 체크 (한글, 영문, 숫자, 하이픈만)
  const validSlugRegex = /^[\w\u3131-\u3163\uac00-\ud7a3-]+$/;
  if (!validSlugRegex.test(slug)) {
    return {
      isValid: false,
      error: '영문, 숫자, 한글, 하이픈(-)만 사용할 수 있습니다.',
    };
  }

  // 시작/끝이 하이픈인지 체크
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return {
      isValid: false,
      error: 'URL 슬러그는 하이픈으로 시작하거나 끝날 수 없습니다.',
    };
  }

  // 연속 하이픈 체크
  if (slug.includes('--')) {
    return {
      isValid: false,
      error: '연속된 하이픈은 사용할 수 없습니다.',
    };
  }

  // 예약어 체크
  if (RESERVED_SLUGS.includes(slug.toLowerCase())) {
    return {
      isValid: false,
      error: `'${slug}'는 시스템에서 사용하는 예약어입니다. 다른 URL을 입력해주세요.`,
    };
  }

  return { isValid: true };
}

/**
 * UUID v4 생성 (비공개 설문용)
 * crypto.randomUUID() 사용 — Node.js 18+ 및 모던 브라우저 전부 지원.
 * private_token 의 권위 소스는 surveys.private_token 의 DB 기본값(gen_random_uuid())이며,
 * 이 함수는 클라이언트측 미리보기/재발급용 보조 생성기다.
 * 미지원 환경은 약한 Math.random 폴백 대신 fail-fast(throw) 한다.
 */
export function generatePrivateToken(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error(
      'crypto.randomUUID() 를 사용할 수 없습니다. private_token 을 생성하려면 Node.js 18+ 또는 모던 브라우저 환경이 필요합니다.',
    );
  }

  return crypto.randomUUID();
}

/**
 * 문자열이 UUID 형식인지 확인
 * 모든 UUID 버전을 허용하는 유연한 검증
 */
export function isUUID(str: string): boolean {
  // 일반적인 UUID 형식: 8-4-4-4-12 (총 36자, 하이픈 포함)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * 설문 접근 식별자(경로에 들어갈 값) 계산.
 * 공개면 slug(없으면 id), 비공개면 privateToken(없으면 id).
 * getSurveyAccessUrl 과 테스트 링크 생성이 공유하는 단일 규약.
 */
export function getSurveyAccessIdentifier(survey: {
  id: string;
  slug?: string | null | undefined;
  privateToken?: string | null | undefined;
  isPublic: boolean;
}): string {
  if (survey.isPublic) return survey.slug || survey.id;
  return survey.privateToken || survey.id;
}

/**
 * 설문 접근 URL 생성
 *
 * 한글 슬러그는 percent-encoding 없이 원문 그대로 사용한다 (2026-07-02 결정).
 * 인코딩된 %EB%85... URL 이 공유 화면에서 깨져 보이는 문제가 더 커서,
 * 문자(SMS)·구형 링크 파서가 한글 경로에서 링크를 끊을 수 있는 리스크는 감수한다.
 * 슬러그 허용 문자는 한글·영문·숫자·하이픈뿐이라(validateSlug) URL 구조는 깨지지 않는다.
 *
 * @param survey 설문 객체
 * @param baseUrl 기본 URL (기본값: 현재 origin)
 * @returns 설문 접근 URL
 */
export function getSurveyAccessUrl(
  survey: {
    id: string;
    slug?: string | null | undefined;
    privateToken?: string | null | undefined;
    settings: { isPublic: boolean };
  },
  baseUrl: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const identifier = getSurveyAccessIdentifier({
    id: survey.id,
    slug: survey.slug,
    privateToken: survey.privateToken,
    isPublic: survey.settings.isPublic,
  });
  return `${baseUrl}/survey/${identifier}`;
}

/**
 * URL에서 설문 식별자 추출 및 타입 판별
 * @param identifier URL에서 추출한 식별자
 * @returns 식별자 타입과 값
 */
export function parsesurveyIdentifier(identifier: string): {
  type: 'slug' | 'privateToken' | 'id';
  value: string;
} {
  // UUID 형식이면 privateToken
  if (isUUID(identifier)) {
    return { type: 'privateToken', value: identifier };
  }

  // survey- 로 시작하면 내부 ID
  if (identifier.startsWith('survey-')) {
    return { type: 'id', value: identifier };
  }

  // 그 외는 slug
  return { type: 'slug', value: identifier };
}

/**
 * 슬러그에 고유 접미사 추가 (중복 방지용)
 * @param baseSlug 기본 슬러그
 * @returns 고유 접미사가 추가된 슬러그
 */
export function appendUniqueSlugSuffix(baseSlug: string): string {
  const suffix = Math.random().toString(36).substring(2, 6);
  const maxBaseLength = 50 - suffix.length - 1; // -1 for hyphen
  const truncatedBase = baseSlug.slice(0, maxBaseLength);
  return `${truncatedBase}-${suffix}`;
}
