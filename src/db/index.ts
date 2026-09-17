import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { createPostgresOptions } from './postgres-options';
import * as schema from './schema';

// 환경 변수에서 데이터베이스 URL 가져오기
const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.');
}

// postgres.js 클라이언트 생성
const client = postgres(connectionString, createPostgresOptions());

// Drizzle ORM 인스턴스 생성
export const db = drizzle(client, { schema });

/** db.transaction 콜백이 받는 트랜잭션 핸들 — 서비스·헬퍼가 tx 를 주입받을 때의 공용 타입. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 트랜잭션 밖(db)과 안(tx) 어느 쪽에서도 실행 가능한 헬퍼의 executor 타입. */
export type DbOrTx = typeof db | DbTransaction;

// 스키마 export
export * from './schema';
