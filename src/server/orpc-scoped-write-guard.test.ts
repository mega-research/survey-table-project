/**
 * scoped 베이스 쓰기 procedure 는 전부 assertSurveyWriteAccess 를 부른다 — 소스 가드.
 *
 * 보기만 하는 게스트(guest-grants 의 VIEW_ONLY_GUEST_GRANTS)는 설문 접근(assertSurveyAccess)을
 * 통과한다. 화면 메뉴·경로 차단(미들웨어)은 /api/rpc 에 걸리지 않으므로, 쓰기 procedure 가
 * 설문 접근만 확인하면 직접 요청으로 조사 대상·회차를 고치거나 메일을 보낼 수 있었다(2026-11-03).
 * 새 scoped procedure 를 만들면 이 테스트가 읽기인지 쓰기인지 묻는다 — 읽기면 READ_ONLY 에 적는다.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(__dirname);

/** 읽기만 하는 scoped procedure — 보기 전용 게스트도 부를 수 있다. `<도메인>/<파일>:<이름>` */
const READ_ONLY = new Set([
  'contacts/attr-values:list',
  'contacts/attr-values:nonNumericCount',
  'mail/campaigns:fetchCandidateIds',
  'mail/campaigns:previewPreflight',
  'mail/preview:sample',
  'survey-document/documents:list',
  'survey-document/anchors:list',
]);

/** 입력에 surveyId 가 없어 설문 단위 판정을 못 하는 예외 (orpc.ts scoped 주석 참조) */
const NO_SURVEY_ID = new Set(['media/media:deleteMailAttachmentTmp']);

type ScopedProcedure = { key: string; body: string };

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

describe('scoped 쓰기 procedure 의 쓰기 권한 확인', () => {
  const procedures = collectScopedProcedures();

  it('scoped procedure 를 실제로 찾는다', () => {
    expect(procedures.length).toBeGreaterThan(15);
  });

  it('쓰기 procedure 는 assertSurveyWriteAccess 를 부른다', () => {
    const missing = procedures
      .filter((p) => !READ_ONLY.has(p.key) && !NO_SURVEY_ID.has(p.key))
      .filter((p) => !p.body.includes('assertSurveyWriteAccess('))
      .map((p) => p.key);
    expect(missing).toEqual([]);
  });

  it('읽기 procedure 는 assertSurveyAccess 로 설문 접근을 확인한다', () => {
    const missing = procedures
      .filter((p) => READ_ONLY.has(p.key))
      .filter((p) => !p.body.includes('assertSurveyAccess('))
      .map((p) => p.key);
    expect(missing).toEqual([]);
  });

  it('READ_ONLY · NO_SURVEY_ID 목록에 사라진 procedure 가 남아 있지 않다', () => {
    const keys = new Set(procedures.map((p) => p.key));
    expect([...READ_ONLY, ...NO_SURVEY_ID].filter((k) => !keys.has(k))).toEqual([]);
  });
});
