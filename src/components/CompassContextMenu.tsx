import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AppIcon } from './AppIcon'

const INTERACTIVE_INTRO_URL =
  'https://compass-official.pages.dev/INTRO_Interactive/'
const DEVELOPER_URL = 'https://compass-official.pages.dev/founder/'

export function CompassContextMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  useEffect(() => {
    setIsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="compass-context" ref={containerRef}>
      <button
        aria-controls="compass-context-links"
        aria-expanded={isOpen}
        aria-label="COMPASSのリンクを開く"
        className="compass-context-trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title="COMPASSについて"
        type="button"
      >
        <AppIcon name="compass" size={18} />
      </button>

      <div
        className="compass-context-panel"
        hidden={!isOpen}
        id="compass-context-links"
      >
        <p>COMPASS</p>
        <a
          href={INTERACTIVE_INTRO_URL}
          onClick={() => setIsOpen(false)}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span className="compass-context-link-icon">
            <AppIcon name="sparkles" size={17} />
          </span>
          <span>
            <strong>Interactiveについて</strong>
            <small>講義体験と機能を見る</small>
          </span>
          <AppIcon name="arrow-right" size={15} />
        </a>
        <a
          href={DEVELOPER_URL}
          onClick={() => setIsOpen(false)}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span className="compass-context-link-icon">
            <AppIcon name="compass" size={17} />
          </span>
          <span>
            <strong>Meet the Developer</strong>
            <small>Yuto Matsui — Interactiveの開発者</small>
          </span>
          <AppIcon name="arrow-right" size={15} />
        </a>
      </div>
    </div>
  )
}
