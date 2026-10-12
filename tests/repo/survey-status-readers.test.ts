import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `surveys.status` 를 SQL 로 읽는 자리의 인벤토리 (ADR-0030, 티켓 01).
 *
 * 설문 종료는 **응답 접수와 외부 링크만** 닫는다. 내부 콘솔(빌더·운영·분석·내보내기)과 메일
 * 발송은 종료된 설문에서도 종전대로 돌아야 한다 — 그 약속이 지금 성립하는 이유는 그쪽 서버
 * 코드가 `surveys.status` 를 아예 읽지 않기 때문이다(「발행된 적 있는가」는 `currentVersionId`
 * 로 묻는다).
 *
 * 그 사실은 조용히 깨진다. 누가 운영 집계나 메일 대상 조회에 `status = 'published'` 조건을
 * 하나 더하면 tsc 도 기존 테스트도 통과하고, 종료된 설문에서만 화면이 비거나 발송이 0건이
 * 된다 — 조사가 끝난 뒤의 정리 작업이 그 순간부터 막힌다.
 *
 * 그래서 이 컬럼을 읽는 파일을 목록으로 못 박는다. **새 자리가 생기면 이 파일이 빨개지고,**
 * 그때 정해야 할 것은 「종료된 설문을 어떻게 다룰 것인가」다:
 *  - 응답자 신규 진입이면 → 닫혀야 한다(`acceptance.ts` 의 판정 표를 쓸 것)
 *  - 내부 화면·집계·발송이면 → `closed` 를 `published` 와 같게 다뤄야 한다
 *  - 표시·필터면 → `closed` 를 따로 그려야 한다
 *
 * 한계: 컬럼 참조(`surveys.status`)만 본다. `db.query.surveys.findFirst({ columns: { status } })`
 * 처럼 행을 받아 필드로 읽는 자리는 잡지 못한다 — 그쪽은 응답 게이트 로더 하나뿐이고 판정이
 * `acceptance.ts` 로 모여 있다.
 */

const REPO_ROOT = join(import.meta.dirname, '../..');
const SCAN_ROOTS = ['src/server', 'src/app', 'src/lib', 'src/actions'];

/** 이 컬럼을 읽어도 되는 자리와, 종료된 설문을 어떻게 다루는지. */
const KNOWN_READERS: Record<string, string> = {
  'src/server/operations/services/control.ts':
    '종료 스위치 자신 — 종료 여부 조회와 「발행된 적 있는 설문만」 전이 조건',
  'src/server/survey-builder/services/survey-publish.ts':
    '배포 확인 창의 재료 — 종료된 설문이면 배포가 종료를 푼다고 알린다(표시용)',
  'src/server/survey-response/services/response-manage.ts':
    '재응답 허용 게이트 — 판정은 acceptance.ts 의 reedit 행(종료 거부)',
  'src/server/read-models/survey-structure.ts':
    '설문 목록 컬럼 — 표시·필터용(종료를 따로 그린다)',
  'src/server/read-models/guest-surveys.ts': '게스트 콘솔의 진행 상태 라벨 — 표시용',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

/** 주석 줄은 뺀다 — 이 컬럼을 설명하는 문장은 읽는 자리가 아니다. */
function readsSurveyStatus(source: string): boolean {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .some((line) => /\bsurveys\.status\b/.test(line));
}

describe('surveys.status 를 읽는 자리', () => {
  const readers = SCAN_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
    .filter((file) => readsSurveyStatus(readFileSync(file, 'utf8')))
    .map((file) => relative(REPO_ROOT, file))
    .sort();

  it('목록에 적힌 자리뿐이다 — 새 자리는 종료된 설문을 어떻게 다룰지 정하고 등재한다', () => {
    expect(readers).toEqual(Object.keys(KNOWN_READERS).sort());
  });

  it('운영·분석·내보내기·메일 서버 코드는 이 컬럼을 읽지 않는다', () => {
    // 위 단언의 따름정리지만 따로 적는다 — 등재 목록이 늘어날 때 「이 구역만은 안 된다」가
    // 목록 뒤에 묻히지 않게 한다. 종료 스위치 자신(control.ts)만 예외다.
    const internalOnly = readers.filter(
      (file) =>
        /^src\/server\/(operations|analytics|mail|contacts|quota)\//.test(file) ||
        /^src\/app\/api\/surveys\//.test(file) ||
        /^src\/lib\/(analytics|operations|mail|spss)\//.test(file),
    );
    expect(internalOnly).toEqual(['src/server/operations/services/control.ts']);
  });
});
