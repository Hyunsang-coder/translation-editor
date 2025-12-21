/**
 * Tauri Command Types
 * Rust 백엔드와 통신하기 위한 타입 정의
 */

import type { ITEProject, EditorBlock, SegmentGroup, HistorySnapshot } from './index';

// ============================================
// Command Response Types
// ============================================

/**
 * Tauri 명령 응답 래퍼
 */
export interface TauriResponse<T> {
  success: boolean;
  data?: T;
  error?: TauriError;
}

/**
 * Tauri 에러 타입
 */
export interface TauriError {
  code: string;
  message: string;
  details?: string;
}

// ============================================
// Project Commands
// ============================================

/**
 * 프로젝트 생성 요청
 */
export interface CreateProjectRequest {
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain: string;
}

/**
 * 프로젝트 저장 요청
 */
export interface SaveProjectRequest {
  project: ITEProject;
  path: string;
}

/**
 * 프로젝트 로드 응답
 */
export type LoadProjectResponse = TauriResponse<ITEProject>;

// ============================================
// Block Commands
// ============================================

/**
 * 블록 업데이트 요청
 */
export interface UpdateBlockRequest {
  blockId: string;
  content: string;
}

/**
 * 블록 분할 요청
 */
export interface SplitBlockRequest {
  blockId: string;
  splitPosition: number;
}

/**
 * 블록 분할 응답
 */
export interface SplitBlockResponse {
  originalBlock: EditorBlock;
  newBlock: EditorBlock;
  updatedSegment: SegmentGroup;
}

/**
 * 블록 병합 요청
 */
export interface MergeBlocksRequest {
  blockIds: string[];
}

// ============================================
// History Commands
// ============================================

/**
 * 스냅샷 생성 요청
 */
export interface CreateSnapshotRequest {
  projectId: string;
  description: string;
  chatSummary?: string;
}

/**
 * 스냅샷 복원 요청
 */
export interface RestoreSnapshotRequest {
  projectId: string;
  snapshotId: string;
}

/**
 * 히스토리 목록 응답
 */
export type ListHistoryResponse = TauriResponse<HistorySnapshot[]>;

// ============================================
// File Commands
// ============================================

/**
 * 파일 선택 다이얼로그 옵션
 */
export interface FileDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
  multiple?: boolean;
}

/**
 * 파일 필터
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * 파일 정보
 */
export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
}

// ============================================
// Database Commands
// ============================================

/**
 * 데이터베이스 쿼리 결과
 */
export interface DbQueryResult<T> {
  rows: T[];
  rowsAffected: number;
}

/**
 * 데이터베이스 상태
 */
export interface DbStatus {
  connected: boolean;
  path: string;
  version: string;
}

