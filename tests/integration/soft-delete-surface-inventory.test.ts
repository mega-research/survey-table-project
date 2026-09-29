/**
 * soft delete 표면 인벤토리 가드 (역할 모델 v2 티켓 17).
 *
 * 이 파일은 **행동을 검증하지 않는다** — 목이 돌려주는 행은 언제나 테스트가 정한 행이라
 * `deleted_at IS NULL` 이 WHERE 에 있든 없든 결과가 같기 때문이다(티켓 15 가 같은 이유로
 * 하위 행 축을 realdb 로 보냈다). 여기서 지키는 것은 **목록이 라우터와 어긋나지 않는가**
 * 하나다.
 *
 * 그래서 역할 분담이 이렇게 된다.
 *  - 여기(`pnpm test`)   : 새 pub 표면이 붙으면 즉시 빨개져 인벤토리 등재를 강요한다.
 *  - realdb 스위트       : 등재된 표면이 실제로 삭제된 설문을 거부하는지 본다.
 *
 * 앞의 것이 없으면 새 표면이 조용히 검증 밖으로 빠지고, 뒤의 것이 없으면 등재가 서류 작업이
 * 된다. 둘 다 있어야 「전수」가 사실이 된다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '@tests/helpers/app-files';
import {
  PUB_SURVEY_SURFACES,
  PUB_TOKEN_LOOKUPS,
} from '@tests/helpers/deleted-survey-surfaces';
import { enumerateProcedures, takesSurveyId } from '@tests/helpers/rpc-surface';

const procedures = enumerateProcedures();

/** 라우터가 말하는 「설문 id 를 받는 pub 표면」 전수. */
const routerPubSurveySurfaces = procedures
  .filter((p) => p.base === 'pub' && takesSurveyId(p))
  .map((p) => p.path)
  .sort();

describe('삭제된 설문 음성 스위트의 표면 인벤토리', () => {
  it('열거기가 실제로 라우터를 훑는다', () => {
    // 정규식·프로퍼티 이름이 어긋나 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(procedures.length).toBeGreaterThan(100);
    expect(routerPubSurveySurfaces.length).toBeGreaterThan(0);
  });

  it('설문 id 를 받는 pub 표면은 전부 인벤토리에 있다 — 누락 없음', () => {
    expect(routerPubSurveySurfaces).toEqual(Object.keys(PUB_SURVEY_SURFACES).sort());
  });

  it('인벤토리에 라우터가 모르는 유령 표면이 없다', () => {
    const known = new Set(procedures.map((p) => p.path));
    for (const path of Object.keys(PUB_SURVEY_SURFACES)) {
      expect(known.has(path)).toBe(true);
    }
  });

  it('모든 등재 표면이 사유를 갖는다 — 등재만 하고 판단을 안 적는 것을 막는다', () => {
    for (const [path, spec] of Object.entries(PUB_SURVEY_SURFACES)) {
      expect(spec.note.length, `${path} 에 사유가 없다`).toBeGreaterThan(10);
    }
  });

  it('토큰으로 설문을 여는 pub 경로도 전부 등재돼 있고, 각자의 realdb 가 실재한다', () => {
    // 이 축은 `surveyId` 를 받지 않아 라우터 열거에 안 잡힌다 — 초대 코드·프리뷰 토큰·
    // 외주 실사 링크가 그렇다. 목록의 출처가 사람이므로, 최소한 **등재가 서류가 아니라는
    // 것**은 기계가 본다: 이름이 그 realdb 파일에 실제로 나와야 한다.
    for (const [lookup, suite] of Object.entries(PUB_TOKEN_LOOKUPS)) {
      const source = readFileSync(resolve(REPO_ROOT, suite), 'utf8');
      expect(source, `${lookup} 를 두드리는 검증이 ${suite} 에 없다`).toContain(lookup);
    }
  });
});
