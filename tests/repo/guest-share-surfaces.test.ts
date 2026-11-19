/**
 * 담당 범위 표면 등재표(`tests/helpers/guest-share-surfaces.ts`)를 소스와 맞춘다.
 *
 * 등재표만 고치고 코드를 안 고치거나 그 반대면 여기서 빨개진다. 실제로 거르는지(SQL)는 실DB 스위트가 본다 —
 * 이 테스트는 「어느 표면이 범위 게스트에게 열려 있고, 열린 것은 범위를 받아 쓰는가」의 모양만 본다.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NO_SURVEY_ID_SCOPED,
  PAGE_SHARE_SURFACES,
  REST_SHARE_CLOSED,
  SCOPED_SHARE_SURFACES,
} from '../helpers/guest-share-surfaces';

const ROOT = process.cwd();
const SERVER_ROOT = path.join(ROOT, 'src/server');
const APP_ROOT = path.join(ROOT, 'src/app');

type ScopedProcedure = { key: string; body: string };

/** `orpc-scoped-write-guard.test.ts` 와 같은 수집 — scoped 로 시작하는 procedure 선언과 그 본문. */
function collectScopedProcedures(): ScopedProcedure[] {
  const out: ScopedProcedure[] = [];
  for (const domain of fs.readdirSync(SERVER_ROOT)) {
    const dir = path.join(SERVER_ROOT, domain, 'procedures');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const starts = [...src.matchAll(/^const (\w+) = (\w+)\b/gm)];
      starts.forEach((m, i) => {
        if (m[2] !== 'scoped') return;
        const end = starts[i + 1]?.index ?? src.length;
        out.push({
          key: `${domain}/${file.replace(/\.ts$/, '')}:${m[1]}`,
          body: src.slice(m.index, end),
        });
      });
    }
  }
  return out;
}

const IN_SHARE_CALL = /assertSurvey(?:Write)?AccessInShare\(/;
const PLAIN_CALL = /assertSurvey(?:Write)?Access\(/;

describe('담당 범위 — scoped procedure', () => {
  const procedures = collectScopedProcedures().filter((p) => !NO_SURVEY_ID_SCOPED.has(p.key));

  it('scoped procedure 전부가 등재돼 있고, 사라진 procedure 를 가리키는 줄이 없다', () => {
    expect(procedures.map((p) => p.key).sort()).toEqual(Object.keys(SCOPED_SHARE_SURFACES).sort());
  });

  it('닫힌 procedure 는 범위 게스트를 거부하는 확인만 부른다', () => {
    const offenders = procedures
      .filter((p) => SCOPED_SHARE_SURFACES[p.key]?.kind === 'closed')
      .filter((p) => IN_SHARE_CALL.test(p.body) || !PLAIN_CALL.test(p.body))
      .map((p) => p.key);
    expect(offenders).toEqual([]);
  });

  it('거르는 procedure 는 범위를 받아 서비스에 넘긴다', () => {
    const offenders = procedures
      .filter((p) => SCOPED_SHARE_SURFACES[p.key]?.kind === 'filtered')
      .filter((p) => {
        if (!/const share = assertSurvey(?:Write)?AccessInShare\(/.test(p.body)) return true;
        // 받은 범위를 한 번 이상 다시 쓴다(서비스 인자)
        return (p.body.match(/\bshare\b/g) ?? []).length < 2;
      })
      .map((p) => p.key);
    expect(offenders).toEqual([]);
  });

  it('해당 없음으로 여는 procedure 는 InShare 확인을 부르고 사유가 있다', () => {
    for (const p of procedures) {
      const status = SCOPED_SHARE_SURFACES[p.key];
      if (status?.kind !== 'exempt') continue;
      expect(IN_SHARE_CALL.test(p.body), `${p.key} 가 InShare 확인을 부르지 않는다`).toBe(true);
      expect(status.reason.length, `${p.key} 의 사유가 비었다`).toBeGreaterThan(10);
    }
  });
});

describe('담당 범위 — 화면', () => {
  function walkPages(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkPages(full);
      return entry.isFile() && entry.name === 'page.tsx' ? [full] : [];
    });
  }
  const routeOf = (file: string) => file.slice(APP_ROOT.length + 1).replace(/\/?page\.tsx$/, '');
  const pages = new Map(
    walkPages(path.join(APP_ROOT, 'admin')).map((f) => [routeOf(f), fs.readFileSync(f, 'utf8')]),
  );
  const sharedRoutes = [...pages]
    .filter(([, source]) => /requireSurveyConsolePage\(surveyId, \{[^}]*share: 'allow'/.test(source))
    .map(([route]) => route);

  it('범위 게스트에게 여는 화면 전부가 등재돼 있고, 닫힌 화면을 가리키는 줄이 없다', () => {
    expect(sharedRoutes.sort()).toEqual(Object.keys(PAGE_SHARE_SURFACES).sort());
  });

  it('거르는 화면은 가드가 돌려준 계정으로 범위를 푼다', () => {
    const offenders = sharedRoutes.filter((route) => {
      if (PAGE_SHARE_SURFACES[route]?.kind !== 'filtered') return false;
      const source = pages.get(route) ?? '';
      return !/const user = await requireSurveyConsolePage\(/.test(source) ||
        !/resolveGuestShare\(user\.id, surveyId\)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('해당 없음으로 여는 화면은 사유가 있다', () => {
    for (const [route, status] of Object.entries(PAGE_SHARE_SURFACES)) {
      if (status.kind !== 'exempt') continue;
      expect(status.reason.length, `${route} 의 사유가 비었다`).toBeGreaterThan(10);
    }
  });
});

describe('담당 범위 — REST 주소', () => {
  const API_ROOT = path.join(APP_ROOT, 'api');

  it('게스트 판정을 쓰는 라우트는 전부 등재돼 있다', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.isFile() && entry.name === 'route.ts' ? [full] : [];
      });
    // 설문 데이터를 내보내는 라우트 — 설문 접근 판정(canAccessSurvey·canExportSurveyData)을 부르는 것
    const dataRoutes = walk(API_ROOT)
      .filter((f) => /canAccessSurvey\(|canExportSurveyData\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => f.slice(API_ROOT.length + 1));
    expect(dataRoutes.sort()).toEqual(Object.keys(REST_SHARE_CLOSED).sort());
  });

  it('등재된 라우트는 적힌 판정으로 범위 게스트를 거부한다', () => {
    for (const [route, { via }] of Object.entries(REST_SHARE_CLOSED)) {
      const source = fs.readFileSync(path.join(API_ROOT, route), 'utf8');
      expect(source.includes(via), `${route} 에 ${via} 가 없다`).toBe(true);
    }
  });
});
