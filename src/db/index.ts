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

// 스키마 export
export * from './schema';
