import { describe, expect, it } from 'vitest';

import type { OperationsPaths } from './operations-paths';
import {
  adminOperationsBase,
  adminOperationsPaths,
  adminSurveyEditPath,
  adminSurveyListPath,
  adminSurveyPreviewPath,
  operationsPaths,
} from './operations-paths';

/**
 * 운영 콘솔 주소 조립 — 하드코딩을 한 곳으로 모은 뒤 basePath 를 주입 가능하게 한 것의 계약.
 *
 * 핵심 단언은 **전수**다: 필드를 하나씩 세는 대신 객체를 순회해 전부가 주어진 base 를 접두로
 * 갖는지 본다. 새 자리가 늘어도 자동으로 덮이고, 누가 한 자리에만 `/admin` 을 다시 박으면
 * 그 자리에서 빨개진다 — 접두를 걷는 작업의 안전망이 이 순회다.
 */

const SURVEY_ID = 'survey-1';
const OTHER_BASE = '/fw/tok3n/operations';

/** 문자열 필드와 함수 필드를 같은 규칙으로 본다 — 함수는 표본 인자로 한 번 부른다. */
function resolveAll(paths: OperationsPaths): Array<[string, string]> {
  return Object.entries(paths).map(([key, value]): [string, string] => [
    key,
    typeof value === 'string' ? value : value('id-1'),
  ]);
}

describe('operationsPaths', () => {
  it('모든 자리가 주어진 base 를 접두로 갖는다', () => {
    const resolved = resolveAll(operationsPaths(OTHER_BASE));
    expect(resolved.length).toBeGreaterThan(10);
    for (const [key, href] of resolved) {
      expect(href, `${key} 가 base 를 따르지 않는다`).toMatch(new RegExp(`^${OTHER_BASE}(/|$)`));
    }
  });

  it('base 를 바꾸면 모든 자리가 함께 따라간다', () => {
    const admin = resolveAll(operationsPaths(adminOperationsBase(SURVEY_ID)));
    const link = resolveAll(operationsPaths(OTHER_BASE));

    expect(link.map(([key]) => key)).toEqual(admin.map(([key]) => key));
    for (const [index, [key, adminHref]] of admin.entries()) {
      const [, linkHref] = link[index]!;
      // 접두만 다르고 그 뒤 꼬리는 완전히 같아야 한다.
      expect(linkHref.slice(OTHER_BASE.length), `${key} 의 꼬리가 갈렸다`).toBe(
        adminHref.slice(adminOperationsBase(SURVEY_ID).length),
      );
    }
  });

  it('base 끝의 슬래시를 흡수해 이중 슬래시를 만들지 않는다', () => {
    for (const [key, href] of resolveAll(operationsPaths(`${OTHER_BASE}/`))) {
      expect(href, `${key} 에 이중 슬래시가 있다`).not.toMatch(/(?<!:)\/\//);
      expect(href).toMatch(new RegExp(`^${OTHER_BASE}(/|$)`));
    }
  });

  it('하위 자리가 base 자체와 겹치지 않는다 — 탭 활성 판정이 접두 비교라 자리마다 달라야 한다', () => {
    const paths = operationsPaths(OTHER_BASE);
    const hrefs = resolveAll(paths)
      .filter(([key]) => key !== 'base')
      .map(([, href]) => href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).not.toContain(OTHER_BASE);
  });
});

describe('admin 접두를 아는 유일한 자리', () => {
  it('운영 콘솔 base 를 설문 id 로 조립한다', () => {
    expect(adminOperationsBase(SURVEY_ID)).toBe(`/admin/surveys/${SURVEY_ID}/operations`);
  });

  it('admin 편의 생성자가 같은 base 의 paths 를 준다', () => {
    // 함수 자리가 있어 객체끼리는 동일성 비교가 되지 않는다 — 풀어낸 주소로 견준다.
    expect(resolveAll(adminOperationsPaths(SURVEY_ID))).toEqual(
      resolveAll(operationsPaths(adminOperationsBase(SURVEY_ID))),
    );
  });

  it('운영 콘솔 밖의 admin 주소도 여기서 나온다', () => {
    expect(adminSurveyListPath()).toBe('/admin/surveys');
    expect(adminSurveyEditPath(SURVEY_ID)).toBe(`/admin/surveys/${SURVEY_ID}/edit`);
    expect(adminSurveyPreviewPath(SURVEY_ID)).toBe(`/admin/surveys/${SURVEY_ID}/preview`);
  });
});
