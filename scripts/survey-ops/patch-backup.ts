/**
 * 운영 설문 고치기 도우미가 커밋 직전에 남기는 「고치기 전 구조」 파일.
 *
 * 도우미는 한 트랜잭션에서 고치기 전 문항·그룹 행을 읽어 변수명 비교에만 쓰고 버렸다. 커밋한 뒤에
 * 「아까 그 칸에 뭐가 적혀 있었지」를 물으면 답할 것이 없었고, 운영 DB 백업은 하루 한 번이라
 * 같은 날 두 번 고친 사이의 상태는 어디에도 없다. 커밋할 때마다 그 행들을 파일로 남긴다.
 *
 * 들어가는 것은 설문 구조(문항·그룹 행 원본)뿐이다 — 응답·명단·개인정보는 없다. 그래서 dump 처럼
 * 며칠 뒤 지우지 않고 둔다. gitignore 된 `.scratch/survey-ops/patch-backups/` 에만 쓴다.
 *
 * 이 파일은 앱 모듈을 값으로 import 하지 않는다(patch.ts 와 같은 이유 — env 를 채우기 전에 읽힌다).
 */
import fs from 'node:fs';
import path from 'node:path';

import type { SurveyStructureRows } from './variables';

export const PATCH_BACKUP_DIR = path.join(
  process.cwd(),
  '.scratch',
  'survey-ops',
  'patch-backups',
);

export interface PatchBackupInput {
  dir: string;
  surveyId: string;
  /** 패치의 한 줄 설명 — 나중에 파일만 보고 어느 수정 직전인지 알 수 있게 */
  title: string;
  /** 어느 DB 를 고쳤는가(prod · staging · local) */
  env: string;
  before: SurveyStructureRows;
  now: Date;
}

/** 파일 이름에 쓸 수 있게 시각을 접는다 — `2026-11-16T02-03-04-005Z`. */
function fileStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * 고치기 전 구조를 파일로 쓰고 그 경로를 돌려준다. 쓰지 못하면 던진다 — 부르는 쪽(커밋 직전)이
 * 그대로 되돌리게 해서 「백업 없이 반영된 수정」이 생기지 않게 한다.
 */
export function writePatchBackup(input: PatchBackupInput): string {
  const { dir, surveyId, title, env, before, now } = input;
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${surveyId}-${fileStamp(now)}.json`);
  const body = {
    kind: 'survey-patch-backup',
    surveyId,
    env,
    title,
    savedAt: now.toISOString(),
    questionRows: before.questionRows,
    groupRows: before.groupRows,
  };
  // wx — 같은 이름이 이미 있으면 덮지 않고 실패한다(같은 밀리초에 두 번 커밋할 일은 없다).
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
  return filePath;
}
