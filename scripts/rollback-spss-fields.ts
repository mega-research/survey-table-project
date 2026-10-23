/**
 * SPSS 필드 마이그레이션 롤백 스크립트
 *
 * migrate-spss-fields.ts가 자동 생성한 백업 파일을 사용하여
 * questions 테이블을 마이그레이션 이전 상태로 복원한다.
 *
 * 사용법:
 *   tsx scripts/rollback-spss-fields.ts                              # 최신 백업 자동 선택, DRY RUN
 *   tsx scripts/rollback-spss-fields.ts --backup <파일명>            # 특정 백업 파일, DRY RUN
 *   DRY_RUN=false tsx scripts/rollback-spss-fields.ts                # 최신 백업으로 실제 롤백
 *   DRY_RUN=false tsx scripts/rollback-spss-fields.ts --backup <파일명>  # 특정 백업으로 실제 롤백
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('⚠️ .env.local 파일을 찾을 수 없습니다.');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const DRY_RUN = process.env.DRY_RUN !== 'false';

/** 백업 파일 경로를 결정한다 */
function resolveBackupFiles(): string[] {
  const backupDir = path.join(process.cwd(), 'backups');
  const backupArgIdx = process.argv.indexOf('--backup');

  if (backupArgIdx !== -1 && process.argv[backupArgIdx + 1]) {
    // 특정 백업 파일 지정
    const specified = process.argv[backupArgIdx + 1];
    const fullPath = path.isAbsolute(specified)
      ? specified
      : path.join(backupDir, specified);

    if (!fs.existsSync(fullPath)) {
      console.error(`❌ 백업 파일을 찾을 수 없습니다: ${fullPath}`);
      process.exit(1);
    }
    return [fullPath];
  }

  // 최신 SPSS 마이그레이션 백업 파일 자동 선택
  if (!fs.existsSync(backupDir)) {
    console.error('❌ backups/ 디렉토리가 없습니다. 마이그레이션을 먼저 실행하세요.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('spss-migration-backup-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('❌ SPSS 마이그레이션 백업 파일이 없습니다.');
    process.exit(1);
  }

  // 각 설문별로 가장 최신 백업 1개씩 선택
  const latestBySurvey = new Map<string, string>();
  for (const file of files) {
    // 파일명: spss-migration-backup-{surveyId}-{timestamp}.json
    const match = file.match(/^spss-migration-backup-([a-f0-9-]+)-/);
    if (match) {
      const surveyId = match[1];
      if (!latestBySurvey.has(surveyId)) {
        latestBySurvey.set(surveyId, path.join(backupDir, file));
      }
    }
  }

  return Array.from(latestBySurvey.values());
}

async function rollback() {
  console.log(`\n⏪ SPSS 필드 마이그레이션 롤백 — ${DRY_RUN ? '[DRY RUN]' : '[LIVE MODE]'}`);
  if (DRY_RUN) {
    console.log('💡 실제 롤백하려면: DRY_RUN=false tsx scripts/rollback-spss-fields.ts\n');
  }

  const backupFiles = resolveBackupFiles();
  console.log(`📂 백업 파일 ${backupFiles.length}개 사용\n`);

  let totalRestored = 0;
  let totalFailed = 0;

  for (const backupFile of backupFiles) {
    console.log(`📄 ${path.basename(backupFile)}`);

    const raw = fs.readFileSync(backupFile, 'utf-8');
    const backup = JSON.parse(raw) as {
      surveyId: string;
      questions: Array<{
        id: string;
        title: string;
        question_code: string | null;
        is_custom_spss_var_name: boolean | null;
        options: unknown;
        table_rows_data: unknown;
        updated_at: string;
      }>;
    };

    console.log(`   설문 ID: ${backup.surveyId}`);
    console.log(`   질문 수: ${backup.questions.length}개\n`);

    for (const q of backup.questions) {
      const restoreData: Record<string, unknown> = {
        question_code: q.question_code,
        is_custom_spss_var_name: q.is_custom_spss_var_name,
        options: q.options,
        table_rows_data: q.table_rows_data,
        updated_at: new Date().toISOString(),
      };

      if (!DRY_RUN) {
        const { error } = await supabase
          .from('questions')
          .update(restoreData)
          .eq('id', q.id);

        if (error) {
          console.error(`   ❌ "${q.title}" (${q.id}) 복원 실패:`, error);
          totalFailed++;
        } else {
          console.log(`   ✅ "${q.title}" → questionCode: ${q.question_code ?? 'null'}`);
          totalRestored++;
        }
      } else {
        console.log(`   [DRY RUN] "${q.title}" → questionCode: ${q.question_code ?? 'null'}`);
        totalRestored++;
      }
    }
    console.log('');
  }

  console.log(`\n🎉 롤백 ${DRY_RUN ? '시뮬레이션' : ''} 완료`);
  console.log(`   복원: ${totalRestored}개 질문`);
  if (totalFailed > 0) {
    console.log(`   실패: ${totalFailed}개 질문`);
  }

  if (DRY_RUN) {
    console.log(`\n💡 실제 롤백: DRY_RUN=false tsx scripts/rollback-spss-fields.ts`);
  }
}

rollback().catch((err) => {
  console.error('❌ 롤백 오류:', err);
  process.exit(1);
});
