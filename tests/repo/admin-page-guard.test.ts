import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guestPathRedirect } from '@/lib/auth/guest-grants';

/**
 * 관리자 화면(RSC 페이지)의 진입 가드 강제 시임.
 *
 * 미들웨어는 grant 보유자의 경로만 제한한다 — grant 도 없고 ADMIN_USER_IDS 에도 없는 세션은
 * `/admin`·`/analytics` 화면을 그대로 통과한다. 그래서 서버가 데이터를 렌더하는 페이지는 첫 줄에서
 * 스스로 거른다(2026-11-11: 조사 대상 목록이 그 세션에 열려 있던 것을 리뷰가 잡았다).
 *
 * 이 표가 「어느 화면이 어느 가드인가」의 정본이다. 새 페이지를 만들면 여기에 한 줄 등재해야 통과한다.
 * 게스트에게 여는 화면인지는 미들웨어 판정(guestPathRedirect)과 대조해 표가 혼자 어긋나지 못하게 한다.
 */
type Guard =
  /** 관리자 전용 — `await requireAdminPage()`. 게스트는 미들웨어도 막는다. */
  | { kind: 'admin' }
  /** 게스트에게도 여는 설문 화면 — `await requireSurveyConsolePage(surveyId[, { viewOnly }])`. */
  | { kind: 'console'; viewOnly?: 'allow' | 'previewGrant' }
  /** 클라이언트 컴포넌트 — 서버가 렌더하는 데이터가 없고, 데이터는 procedure 로만 온다. */
  | { kind: 'client'; reason: string }
  /** 로그인 없이 여는 화면. */
  | { kind: 'open'; reason: string };

const ADMIN: Guard = { kind: 'admin' };
const CONSOLE: Guard = { kind: 'console' };
const OPS = 'admin/surveys/[id]/operations';

const PAGES: Record<string, Guard> = {
  'admin/login': { kind: 'open', reason: '로그인 화면 — 세션이 없는 방문자가 여는 자리다' },
  'admin/profile': {
    kind: 'client',
    reason: '비밀번호 변경 폼 — 서버 데이터가 없고 저장은 서버 액션이 세션을 확인한다',
  },
  'admin/file-cleanup': {
    kind: 'client',
    reason: '목록·취소 모두 authed procedure(media.*)로만 온다',
  },
  'admin/surveys': {
    kind: 'client',
    reason: '설문 목록·삭제·복제 모두 authed procedure(surveyBuilder.*)로만 온다',
  },
  'admin/surveys/create': {
    kind: 'client',
    reason: '빌더 — 저장은 authed procedure 로만 간다',
  },
  'admin/surveys/[id]/edit': {
    kind: 'client',
    reason: '빌더 — 설문 로드·저장 모두 authed procedure 로만 온다',
  },
  'admin/billing/mail-cost': ADMIN,
  'admin/surveys/[id]/analytics': ADMIN,
  'analytics': ADMIN,
  'analytics/[surveyId]': ADMIN,
  'admin/surveys/[id]/preview': { kind: 'console', viewOnly: 'previewGrant' },

  // 운영 콘솔 — 보기만 하는 게스트에게도 여는 둘
  [`${OPS}/overview`]: { kind: 'console', viewOnly: 'allow' },
  [`${OPS}/profiles`]: { kind: 'console', viewOnly: 'allow' },

  // 운영 콘솔 — 게스트에게 여는 화면
  [`${OPS}/contacts`]: CONSOLE,
  [`${OPS}/contacts/[contactId]`]: CONSOLE,
  [`${OPS}/contacts/new`]: CONSOLE,
  [`${OPS}/contacts/prior-answers`]: CONSOLE,
  [`${OPS}/demand`]: CONSOLE,
  [`${OPS}/mail/campaigns`]: CONSOLE,
  [`${OPS}/mail/campaigns/[cid]`]: CONSOLE,
  [`${OPS}/mail/campaigns/new`]: CONSOLE,
  [`${OPS}/mail/templates`]: CONSOLE,
  [`${OPS}/mail/templates/new`]: CONSOLE,
  [`${OPS}/mail/templates/[mid]/edit`]: CONSOLE,
  [`${OPS}/profiles/[responseId]/edit`]: CONSOLE,
  [`${OPS}/profiles/columns`]: CONSOLE,
  [`${OPS}/report`]: CONSOLE,
  [`${OPS}/report/columns`]: CONSOLE,

  // 운영 콘솔 — 관리자 전용 (미들웨어의 blockedSubpaths 와 같은 집합)
  [`${OPS}/contacts/assignments`]: ADMIN,
  [`${OPS}/contacts/assignments/[assignmentId]`]: ADMIN,
  [`${OPS}/contacts/columns`]: ADMIN,
  [`${OPS}/contacts/result-codes`]: ADMIN,
  [`${OPS}/contacts/upload`]: ADMIN,
  [`${OPS}/contacts/upload/new`]: ADMIN,
  [`${OPS}/quota`]: ADMIN,
  [`${OPS}/scale-mean`]: ADMIN,
};

const APP_ROOT = join(process.cwd(), 'src/app');

function walkPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walkPages(full);
    return entry.isFile() && entry.name === 'page.tsx' ? [full] : [];
  });
}

/** `src/app/admin/login/page.tsx` → `admin/login`, `src/app/analytics/page.tsx` → `analytics`. */
function routeOf(file: string): string {
  return file.slice(APP_ROOT.length + 1).replace(/\/?page\.tsx$/, '');
}

const pageFiles = [...walkPages(join(APP_ROOT, 'admin')), ...walkPages(join(APP_ROOT, 'analytics'))];
const sourceByRoute = new Map(pageFiles.map((f) => [routeOf(f), readFileSync(f, 'utf8')]));

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

/** 표의 경로를 실제 주소로 — `[id]`·`[surveyId]` 는 설문 id, 그 밖의 동적 구간은 아무 값. */
function samplePath(route: string): string {
  return `/${route}`
    .replace(/\[(id|surveyId)\]/g, SURVEY_ID)
    .replace(/\[[^\]]+\]/g, 'x1');
}

/** 가드 호출 모양 — 정책 인자까지 표와 같아야 한다. */
function guardCallPattern(guard: Guard): RegExp | null {
  if (guard.kind === 'admin') return /await requireAdminPage\(\)/;
  if (guard.kind === 'console') {
    return guard.viewOnly
      ? new RegExp(
          `await requireSurveyConsolePage\\(surveyId, \\{ viewOnly: '${guard.viewOnly}' \\}\\)`,
        )
      : /await requireSurveyConsolePage\(surveyId\)/;
  }
  return null;
}

describe('관리자 화면 진입 가드', () => {
  it('모든 페이지가 표에 등재돼 있고, 표에 없는 페이지를 가리키는 줄이 없다', () => {
    expect([...sourceByRoute.keys()].sort()).toEqual(Object.keys(PAGES).sort());
  });

  it('서버가 렌더하는 페이지는 표에 적힌 가드를 부른다', () => {
    const offenders: string[] = [];
    for (const [route, guard] of Object.entries(PAGES)) {
      const pattern = guardCallPattern(guard);
      if (!pattern) continue;
      if (!pattern.test(sourceByRoute.get(route) ?? '')) offenders.push(`${route} — ${pattern}`);
    }
    expect(offenders, `가드 호출이 없거나 정책 인자가 표와 다르다:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('가드는 데이터를 읽기 전에 부른다 — 앞에 올 수 있는 await 는 params·searchParams 뿐', () => {
    const offenders: string[] = [];
    for (const [route, guard] of Object.entries(PAGES)) {
      const pattern = guardCallPattern(guard);
      if (!pattern) continue;
      const source = sourceByRoute.get(route) ?? '';
      const body = source.slice(source.indexOf('export default'));
      const before = body.slice(0, body.search(pattern));
      const earlier = [...before.matchAll(/await\s+([^\n;]+)/g)]
        .map((m) => m[1] ?? '')
        .filter((expr) => !/^(params|searchParams)\b/.test(expr));
      if (earlier.length > 0) offenders.push(`${route} — 가드 앞: await ${earlier.join(', await ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('가드 없이 두는 페이지는 사유가 있고, 클라이언트 컴포넌트라고 적은 것은 실제로 그렇다', () => {
    for (const [route, guard] of Object.entries(PAGES)) {
      if (guard.kind !== 'client' && guard.kind !== 'open') continue;
      expect(guard.reason.length, `${route} 의 사유가 비었다`).toBeGreaterThan(10);
      if (guard.kind === 'client') {
        expect(sourceByRoute.get(route), `${route} 는 'use client' 페이지가 아니다`).toMatch(
          /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*'use client';/,
        );
      }
    }
  });

  it('표가 미들웨어 판정과 같다 — 게스트에게 여는 화면만 console, 보기 전용 정책도 같다', () => {
    const mismatches: string[] = [];
    for (const [route, guard] of Object.entries(PAGES)) {
      if (guard.kind === 'open') continue;
      const path = samplePath(route);
      const guestOpen = guestPathRedirect(path, [SURVEY_ID]) === null;
      const viewOnlyOpen = guestPathRedirect(path, [SURVEY_ID], [SURVEY_ID]) === null;
      const viewOnlyPreviewOpen =
        guestPathRedirect(path, [SURVEY_ID], [SURVEY_ID], [SURVEY_ID]) === null;

      const expectGuestOpen = guard.kind === 'console';
      const expectViewOnlyOpen = guard.kind === 'console' && guard.viewOnly === 'allow';
      const expectViewOnlyPreviewOpen =
        guard.kind === 'console' &&
        (guard.viewOnly === 'allow' || guard.viewOnly === 'previewGrant');

      if (guestOpen !== expectGuestOpen) mismatches.push(`${route} — 게스트: 미들웨어 ${guestOpen}`);
      if (viewOnlyOpen !== expectViewOnlyOpen) {
        mismatches.push(`${route} — 보기 전용: 미들웨어 ${viewOnlyOpen}`);
      }
      if (viewOnlyPreviewOpen !== expectViewOnlyPreviewOpen) {
        mismatches.push(`${route} — 보기 전용(설문 보기 허용): 미들웨어 ${viewOnlyPreviewOpen}`);
      }
    }
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
