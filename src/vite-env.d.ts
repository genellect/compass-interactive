/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRESENTER_CERTIFICATION_MODE?: 'false' | 'true'
  readonly VITE_PRESENTER_STORE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
