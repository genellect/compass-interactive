import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(rootDir, 'dist')
const indexPath = join(distDir, 'index.html')
const routes = ['join', 'lecture', 'admin', 'display', 'demo']

if (!existsSync(indexPath)) {
  throw new Error('dist/index.html was not found. Run vite build first.')
}

for (const route of routes) {
  const routeDir = join(distDir, route)
  mkdirSync(routeDir, { recursive: true })
  copyFileSync(indexPath, join(routeDir, 'index.html'))
}
