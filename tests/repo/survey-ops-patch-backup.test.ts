/**
 * 운영 설문 고치기 도우미의 「고치기 전 구조」 파일(scripts/survey-ops/patch-backup).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writePatchBackup } from '../../scripts/survey-ops/patch-backup';
import type { SurveyStructureRows } from '../../scripts/survey-ops/variables';

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';

const before = {
  questionRows: [{ id: 'q1', title: '이용 경로', questionCode: 'Q1' }],
  groupRows: [{ id: 'g1', name: '기본' }],
} as unknown as SurveyStructureRows;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-backup-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writePatchBackup', () => {
  it('설문 id 와 시각으로 이름 지은 파일에 고치기 전 문항·그룹 행을 그대로 쓴다', () => {
    const target = path.join(dir, 'nested', 'patch-backups');
    const filePath = writePatchBackup({
      dir: target,
      surveyId: SURVEY_ID,
      title: '문2 설명 둘째 줄',
      env: 'prod',
      before,
      now: new Date('2026-11-16T02:03:04.005Z'),
    });

    expect(filePath).toBe(path.join(target, `${SURVEY_ID}-2026-11-16T02-03-04-005Z.json`));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({
      kind: 'survey-patch-backup',
      surveyId: SURVEY_ID,
      env: 'prod',
      title: '문2 설명 둘째 줄',
      savedAt: '2026-11-16T02:03:04.005Z',
      questionRows: before.questionRows,
      groupRows: before.groupRows,
    });
  });

  it('같은 이름의 파일이 있으면 덮지 않고 던진다', () => {
    const input = {
      dir,
      surveyId: SURVEY_ID,
      title: '첫 수정',
      env: 'prod',
      before,
      now: new Date('2026-11-16T02:03:04.005Z'),
    };
    const filePath = writePatchBackup(input);
    expect(() => writePatchBackup({ ...input, title: '둘째 수정' })).toThrow();
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8')).title).toBe('첫 수정');
  });
});
