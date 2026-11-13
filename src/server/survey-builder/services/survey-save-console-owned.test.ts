import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 전체 완료 목표(`surveys.max_responses`)는 운영 콘솔이 정하는 라이브 컬럼이다
 * (CONTEXT.md 「전체 완료 목표」). 빌더 저장이 열 때 읽은 값으로 이 컬럼을 다시 쓰면, 콘솔에서
 * 목표를 건 뒤 옛 빌더 탭이 저장하는 순간 목표가 비워진다 — 빌더 동시 저장은 막는 장치가 없다.
 * 저장 3곳(메타데이터·전체 저장 UPDATE·onConflict)이 모두 이 컬럼을 건드리지 않아야 한다.
 *
 * 쓰기 페이로드가 `Record<string, unknown>` 로 조립돼 tsc 가 잡지 못하므로 소스를 읽어 막는다.
 */
describe('survey-save — 콘솔 소유 컬럼', () => {
  const source = readFileSync(resolve(__dirname, 'survey-save.ts'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('빌더 저장은 전체 완료 목표(maxResponses)를 쓰지 않는다', () => {
    expect(source).not.toMatch(/\bmaxResponses\s*:/);
    expect(source).not.toMatch(/max_responses/);
  });

  it('같은 라이브 운영 컬럼 — 중단·쿼터 — 도 쓰지 않는다', () => {
    expect(source).not.toMatch(/\bisPaused\s*:/);
    expect(source).not.toMatch(/\bquotaConfig\s*:/);
  });

  it('설문 수정(surveys.update)도 실려 온 maxResponses 를 버린다 — 입력을 통째로 펼쳐 쓰는 경로다', () => {
    const surveysSource = readFileSync(resolve(__dirname, 'surveys.ts'), 'utf8');
    const updateSurvey = surveysSource.slice(
      surveysSource.indexOf('export async function updateSurvey'),
      surveysSource.indexOf('export async function', surveysSource.indexOf('export async function updateSurvey') + 1),
    );
    expect(updateSurvey).toMatch(/\{\s*maxResponses: _consoleOwned,\s*\.\.\.data\s*\}/);
    // 펼쳐 쓰는 것은 걸러 낸 data 에서 나온 것뿐이다.
    expect(updateSurvey).not.toMatch(/\.\.\.input\.data/);
  });
});
