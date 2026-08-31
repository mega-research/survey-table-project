import { describe, it, expect } from 'vitest';

import {
  findMigrationDrift,
  findNewDuplicatePrefixes,
} from '../../../.github/migration-journal-gate';

describe('findMigrationDrift', () => {
  it('journal 에 추적된 파일은 untracked 가 아니다', () => {
    const r = findMigrationDrift({
      sqlFiles: ['0000_init'],
      journalTags: ['0000_init'],
      manualTags: [],
    });
    expect(r.untracked).toEqual([]);
  });

  it('manifest 에 등재된 파일은 untracked 가 아니다', () => {
    const r = findMigrationDrift({
      sqlFiles: ['0035_enable_rls'],
      journalTags: [],
      manualTags: ['0035_enable_rls'],
    });
    expect(r.untracked).toEqual([]);
  });

  it('journal 에도 manifest 에도 없는 파일은 untracked 로 잡는다', () => {
    const r = findMigrationDrift({
      sqlFiles: ['0040_orphan_migration'],
      journalTags: ['0000_init'],
      manualTags: ['0035_enable_rls'],
    });
    expect(r.untracked).toEqual(['0040_orphan_migration']);
  });

  it('manifest 에 있으나 대응 .sql 파일이 없으면 orphanManifest 로 잡는다', () => {
    const r = findMigrationDrift({
      sqlFiles: ['0035_enable_rls'],
      journalTags: [],
      manualTags: ['0035_enable_rls', '0099_deleted_file'],
    });
    expect(r.orphanManifest).toEqual(['0099_deleted_file']);
  });

  it('journal·manifest 양쪽에 있어도 위반이 아니다', () => {
    const r = findMigrationDrift({
      sqlFiles: ['0010_dual'],
      journalTags: ['0010_dual'],
      manualTags: ['0010_dual'],
    });
    expect(r.untracked).toEqual([]);
    expect(r.orphanManifest).toEqual([]);
  });
});

describe('findNewDuplicatePrefixes', () => {
  it('접두가 겹치지 않으면 빈 배열', () => {
    expect(
      findNewDuplicatePrefixes({
        sqlFiles: ['0094_contact_prior_answers', '0095_sweep_prior'],
      }),
    ).toEqual([]);
  });

  it('새로 생긴 접두 중복을 잡는다', () => {
    expect(
      findNewDuplicatePrefixes({
        sqlFiles: ['0084_contact_prior_answers', '0084_better_auth_tables'],
      }),
    ).toEqual([
      { prefix: '0084', files: ['0084_better_auth_tables', '0084_contact_prior_answers'] },
    ]);
  });

  it('이미 공존하는 0003 / 0009 / 0019 는 유예한다', () => {
    expect(
      findNewDuplicatePrefixes({
        sqlFiles: ['0003_a', '0003_b', '0003_c', '0009_a', '0009_b', '0019_a', '0019_b'],
      }),
    ).toEqual([]);
  });

  it('유예 접두라도 목록에 없는 새 중복은 함께 보고한다', () => {
    const r = findNewDuplicatePrefixes({
      sqlFiles: ['0003_a', '0003_b', '0100_x', '0100_y'],
    });
    expect(r.map((d) => d.prefix)).toEqual(['0100']);
  });

  it('접두가 없는 파일명은 판정 대상이 아니다', () => {
    expect(findNewDuplicatePrefixes({ sqlFiles: ['seed_data', 'seed_more'] })).toEqual([]);
  });
});
