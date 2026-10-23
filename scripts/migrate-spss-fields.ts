/**
 * SPSS 필드 마이그레이션 스크립트
 *
 * 기존 questions 테이블의 데이터에 SPSS 관련 필드를 초기화한다.
 * - questionCode가 있는 질문 → isCustomSpssVarName: true, 기존 코드 보존
 * - questionCode가 없는 질문 → 순서 기반 자동 할당 (Q1, Q2, Q3...)
 * - options JSONB 내 spssNumericCode가 없는 옵션 → 순서 기준 1부터 할당
 * - tableRowsData 내 radio/checkbox/select 셀의 옵션에도 spssNumericCode 할당
 *
 * 사용법:
 *   tsx scripts/migrate-spss-fields.ts              # DRY RUN (변경 없음, 미리보기)
 *   DRY_RUN=false tsx scripts/migrate-spss-fields.ts # 실제 반영
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('⚠️ .env.local 파일을 찾을 수 없습니다. 환경 변수를 직접 사용합니다.');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const DRY_RUN = process.env.DRY_RUN !== 'false';

interface OptionLike {
  id: string;
  label: string;
  value: string;
  spssNumericCode?: number;
  [key: string]: unknown;
}

interface CellLike {
  id: string;
  type: string;
  checkboxOptions?: OptionLike[];
  radioOptions?: OptionLike[];
  selectOptions?: OptionLike[];
  [key: string]: unknown;
}

interface RowLike {
  id: string;
  cells: CellLike[];
  [key: string]: unknown;
}

/** 옵션 배열에 spssNumericCode를 할당한다 (없는 것만) */
function assignNumericCodes(options: OptionLike[]): { options: OptionLike[]; changed: boolean } {
  let changed = false;
  const updated = options.map((opt, idx) => {
    if (opt.spssNumericCode == null) {
      changed = true;
      return { ...opt, spssNumericCode: idx + 1 };
    }
    return opt;
  });
  return { options: updated, changed };
}

/** 테이블 행 데이터 내 셀 옵션에 spssNumericCode를 할당한다 */
function assignTableCellCodes(rows: RowLike[]): { rows: RowLike[]; changed: boolean } {
  let changed = false;
  const updated = rows.map((row) => {
    const updatedCells = row.cells.map((cell) => {
      const newCell = { ...cell };
      if (cell.checkboxOptions) {
        const result = assignNumericCodes(cell.checkboxOptions);
        if (result.changed) {
          changed = true;
          newCell.checkboxOptions = result.options;
        }
      }
      if (cell.radioOptions) {
        const result = assignNumericCodes(cell.radioOptions);
        if (result.changed) {
          changed = true;
          newCell.radioOptions = result.options;
        }
      }
      if (cell.selectOptions) {
        const result = assignNumericCodes(cell.selectOptions);
        if (result.changed) {
          changed = true;
          newCell.selectOptions = result.options;
        }
      }
      return newCell;
    });
    return { ...row, cells: updatedCells };
  });
  return { rows: updated, changed };
}

async function migrate() {
  console.log(`\n🔄 SPSS 필드 마이그레이션 — ${DRY_RUN ? '[DRY RUN]' : '[LIVE MODE]'}`);
  if (DRY_RUN) {
    console.log('💡 실제 반영하려면: DRY_RUN=false tsx scripts/migrate-spss-fields.ts\n');
  }

  // 1. 마이그레이션 전 백업 저장
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // 2. 설문별로 질문 조회
  const { data: allSurveys, error: surveyErr } = await supabase
    .from('surveys')
    .select('id, title');

  if (surveyErr) {
    console.error('❌ 설문 조회 실패:', surveyErr);
    process.exit(1);
  }

  console.log(`📋 총 ${allSurveys.length}개 설문 발견\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const survey of allSurveys) {
    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('*')
      .eq('survey_id', survey.id)
      .order('order', { ascending: true });

    if (qErr) {
      console.error(`  ❌ 질문 조회 실패 (${survey.title}):`, qErr);
      continue;
    }

    if (questions.length === 0) {
      console.log(`  ⏭️ "${survey.title}" — 질문 없음, 건너뜀`);
      continue;
    }

    console.log(`📝 "${survey.title}" (${questions.length}개 질문)`);

    // 백업 데이터 저장 (마이그레이션 전 원본)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(
      backupDir,
      `spss-migration-backup-${survey.id}-${timestamp}.json`,
    );
    fs.writeFileSync(backupFile, JSON.stringify({ surveyId: survey.id, questions }, null, 2));
    console.log(`  💾 백업 저장: ${path.basename(backupFile)}`);

    // notice 제외한 순번 계산
    let autoIndex = 1;

    for (const q of questions) {
      const updates: Record<string, unknown> = {};
      const changeLog: string[] = [];

      // --- questionCode (SPSS 변수명) ---
      if (q.type === 'notice') {
        // notice는 변수명 없음
        if (q.question_code) {
          updates.question_code = null;
          changeLog.push(`questionCode: "${q.question_code}" → null (notice)`);
        }
      } else if (q.question_code) {
        // 기존 코드 있음 → 수동으로 표시
        if (!q.is_custom_spss_var_name) {
          updates.is_custom_spss_var_name = true;
          changeLog.push(`isCustomSpssVarName: false → true (기존 코드 "${q.question_code}" 보존)`);
        }
        autoIndex++; // 순번은 증가시키되, 자동 할당은 안 함
      } else {
        // 기존 코드 없음 → 자동 할당
        const varName = `Q${autoIndex}`;
        updates.question_code = varName;
        updates.is_custom_spss_var_name = false;
        changeLog.push(`questionCode: null → "${varName}" (자동)`);
        autoIndex++;
      }

      // --- options JSONB 내 spssNumericCode ---
      if (q.options && Array.isArray(q.options)) {
        const result = assignNumericCodes(q.options as OptionLike[]);
        if (result.changed) {
          updates.options = result.options;
          changeLog.push(`options: spssNumericCode 할당 (${result.options.length}개)`);
        }
      }

      // --- tableRowsData 내 셀 옵션 spssNumericCode ---
      if (q.table_rows_data && Array.isArray(q.table_rows_data)) {
        const result = assignTableCellCodes(q.table_rows_data as RowLike[]);
        if (result.changed) {
          updates.table_rows_data = result.rows;
          changeLog.push('tableRowsData: 셀 옵션 spssNumericCode 할당');
        }
      }

      if (Object.keys(updates).length === 0) {
        totalSkipped++;
        continue;
      }

      console.log(`  📌 "${q.title}" (${q.id})`);
      changeLog.forEach((log) => console.log(`      ${log}`));

      if (!DRY_RUN) {
        updates.updated_at = new Date().toISOString();
        const { error: updateErr } = await supabase
          .from('questions')
          .update(updates)
          .eq('id', q.id);

        if (updateErr) {
          console.error(`      ❌ 업데이트 실패:`, updateErr);
        } else {
          console.log(`      ✅ 업데이트 완료`);
          totalUpdated++;
        }
      } else {
        console.log(`      [DRY RUN] 업데이트 예정`);
        totalUpdated++;
      }
    }
    console.log('');
  }

  console.log(`\n🎉 마이그레이션 ${DRY_RUN ? '시뮬레이션' : ''} 완료`);
  console.log(`   업데이트: ${totalUpdated}개 질문`);
  console.log(`   건너뜀: ${totalSkipped}개 질문 (변경 불필요)`);

  if (DRY_RUN) {
    console.log(`\n💡 실제 반영: DRY_RUN=false tsx scripts/migrate-spss-fields.ts`);
    console.log(`💡 롤백: tsx scripts/rollback-spss-fields.ts --backup <백업파일>`);
  }
}

migrate().catch((err) => {
  console.error('❌ 마이그레이션 오류:', err);
  process.exit(1);
});
