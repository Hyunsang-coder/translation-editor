/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  test: {
    // jsdom 환경에서 React 컴포넌트 테스트
    environment: 'jsdom',

    // 글로벌 테스트 API (describe, it, expect 등)
    globals: true,

    // 테스트 셋업 파일
    setupFiles: ['./src/test/setup.ts'],

    // 테스트 파일 패턴
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    // node_modules 제외
    exclude: ['node_modules', 'dist', 'src-tauri'],

    // 커버리지 설정
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/mocks/',
      ],
    },

    // 타임아웃 설정
    testTimeout: 10000,
    hookTimeout: 10000,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@editor': path.resolve(__dirname, './src/editor'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
    },
  },
});
