/// <reference types="vite/client" />

// vite.config.ts에서 정의한 전역 변수
declare const __APP_VERSION__: string;
/** Vite serve(dev)에서만 .env/.env.local 값이 주입됨. production build는 빈 문자열. */
declare const __DEV_OPENAI_API_KEY__: string;
declare const __DEV_ANTHROPIC_API_KEY__: string;
