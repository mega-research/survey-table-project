// 마이그레이션 재생 순서를 표준출력으로 내보낸다 (한 줄에 tag 하나).
//
// 순서: journal(idx 순, drizzle 이 실제 적용한 순서) → manual(manual-migrations.json 등재 순).
// 파일명 prefix 는 0003/0009/0019 에서 중복되므로 정렬 기준으로 쓸 수 없다.
// 두 목록은 서로소이며 합집합이 supabase/migrations 의 .sql 전량과 일치해야 한다 —
// 어긋나면 추적되지 않는 마이그레이션이 있다는 뜻이라 즉시 실패시킨다.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';

const journalTags = JSON.parse(readFileSync(join(DIR, 'meta/_journal.json'), 'utf8'))
  .entries.slice()
  .sort((a, b) => a.idx - b.idx)
  .map((e) => e.tag);
const manualTags = JSON.parse(readFileSync(join(DIR, 'manual-migrations.json'), 'utf8')).migrations;

const tags = [...journalTags, ...manualTags];
if (new Set(tags).size !== tags.length) {
  throw new Error('journal 과 manual 에 중복 등재된 tag 가 있습니다.');
}

const onDisk = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''));
const known = new Set(tags);
const orphans = onDisk.filter((t) => !known.has(t));
const missing = tags.filter((t) => !onDisk.includes(t));
if (orphans.length) {
  throw new Error(`추적되지 않는 마이그레이션: ${orphans.join(', ')}`);
}
if (missing.length) {
  throw new Error(`등재됐으나 파일이 없는 마이그레이션: ${missing.join(', ')}`);
}

// --objects-only: push(drizzle-kit)가 표현하지 못하는 객체를 담은 파일만 추린다.
// 테이블·컬럼은 push 가 이미 만들었으므로, 테스트 DB 에 덧입혀야 하는 것은 함수·인덱스·
// RLS·GRANT 뿐이다. 판정은 파일 내용 기준이라 새 마이그레이션이 늘어도 자동으로 잡힌다.
const OBJECT_STATEMENT =
  /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|CREATE\s+(UNIQUE\s+)?INDEX|ENABLE\s+ROW\s+LEVEL|CREATE\s+POLICY|^\s*(GRANT|REVOKE)/im;

const selected = process.argv.includes('--objects-only')
  ? tags.filter((t) => OBJECT_STATEMENT.test(readFileSync(join(DIR, `${t}.sql`), 'utf8')))
  : tags;

// --hash: 재생 순서 전체의 지문. 로컬 테스트 DB 가 "이 레포의 마이그레이션 집합으로"
// 만들어졌는지 확인하는 데 쓴다 (setup-test-db.sh 가 찍고 db-drift.mjs 가 대조).
// 태그 목록과 순서가 모두 반영되므로, 다른 브랜치가 같은 도커 컨테이너를 재생하면
// 반드시 값이 달라진다.
if (process.argv.includes('--hash')) {
  process.stdout.write(createHash('md5').update(tags.join('\n')).digest('hex') + '\n');
} else {
  process.stdout.write(selected.join('\n') + '\n');
}
