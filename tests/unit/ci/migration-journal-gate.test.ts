import { describe, it, expect } from 'vitest';

import { findMigrationDrift } from '../../../.github/migration-journal-gate';

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
