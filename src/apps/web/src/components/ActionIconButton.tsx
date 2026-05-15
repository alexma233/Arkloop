import { useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ShortcutBinding } from '../shortcuts'
import { shortcutAriaLabel } from '../shortcuts'
import { ToolTape } from './ToolTape'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  tooltip?: ReactNode
  shortcut?: ShortcutBinding
  showTooltip?: boolean
  hoverBackground?: string
  pressedScale?: number
  wrapperStyle?: CSSProperties
}

const TOOLTIP_EDGE_GUTTER = 8
const TOOLTIP_MAX_WIDTH = 240
const TOOLTIP_GAP = 4

type TooltipPortalProps = {
  anchorRect: DOMRect
  children: ReactNode
}

function ActionIconTooltip({ anchorRect, children }: TooltipPortalProps) {
  const [tooltipSize, setTooltipSize] = useState<{ width: number; height: number } | null>(null)
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const availableWidth = Math.max(0, viewportWidth - TOOLTIP_EDGE_GUTTER * 2)
  const width = tooltipSize?.width ?? 0
  const height = tooltipSize?.height ?? 0
  const anchorCenterX = anchorRect.left + anchorRect.width / 2
  const showAbove = tooltipSize
    ? anchorRect.bottom + TOOLTIP_GAP + height > viewportHeight && anchorRect.top >= height + TOOLTIP_GAP
    : false
  const centeredLeft = anchorCenterX - width / 2
  const left = tooltipSize ? getTooltipLeft(centeredLeft, width, anchorRect, viewportWidth) : 0
  const top = tooltipSize
    ? showAbove
      ? anchorRect.top - TOOLTIP_GAP - height
      : anchorRect.bottom + TOOLTIP_GAP
    : 0

  return (
    <span
      ref={(node) => {
        if (!node || tooltipSize) return
        const rect = node.getBoundingClientRect()
        setTooltipSize({ width: rect.width, height: rect.height })
      }}
      className={tooltipSize ? 'action-icon-tooltip' : undefined}
      data-side={showAbove ? 'top' : 'bottom'}
      style={{
        position: 'fixed',
        top,
        left,
        maxWidth: Math.min(TOOLTIP_MAX_WIDTH, availableWidth),
        boxSizing: 'border-box',
        visibility: tooltipSize ? 'visible' : 'hidden',
        fontSize: '11px',
        fontWeight: 500,
        color: 'var(--c-tooltip-text)',
        background: 'var(--c-tooltip-bg)',
        border: '0.5px solid var(--c-tooltip-border)',
        borderRadius: '5px',
        padding: '2px 7px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 10000,
      }}
    >
      {children}
    </span>
  )
}

function getTooltipLeft(centeredLeft: number, width: number, anchorRect: DOMRect, viewportWidth: number): number {
  const minLeft = TOOLTIP_EDGE_GUTTER
  const maxLeft = viewportWidth - TOOLTIP_EDGE_GUTTER - width
  if (centeredLeft < minLeft) return Math.min(Math.max(anchorRect.left, minLeft), maxLeft)
  if (centeredLeft > maxLeft) return Math.max(Math.min(anchorRect.right - width, maxLeft), minLeft)
  return centeredLeft
}

export function ActionIconButton({
  children,
  tooltip,
  shortcut,
  showTooltip,
  hoverBackground,
  pressedScale = 0.92,
  wrapperStyle,
  className,
  style,
  disabled = false,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  ...props
}: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null)
  const interactive = !disabled
  const hasTooltip = !!tooltip || !!shortcut
  const tooltipVisible = hasTooltip && !!tooltipRect && (showTooltip ?? (interactive && hovered))
  const shortcutLabel = shortcut ? shortcutAriaLabel(shortcut) : undefined
  const ariaKeyShortcuts = (props as { 'aria-keyshortcuts'?: string })['aria-keyshortcuts'] ?? shortcutLabel
  const ariaLabel = (props as { 'aria-label'?: string })['aria-label'] ?? (typeof tooltip === 'string' ? tooltip : undefined)

  const handleMouseEnter: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    if (interactive) {
      setHovered(true)
      if (hasTooltip) setTooltipRect(buttonRef.current?.getBoundingClientRect() ?? null)
    }
    onMouseEnter?.(event)
  }

  const handleMouseLeave: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    setHovered(false)
    setTooltipRect(null)
    onMouseLeave?.(event)
  }

  const handlePointerDown: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    if (interactive) setPressed(true)
    onPointerDown?.(event)
  }

  const handlePointerUp: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    setPressed(false)
    onPointerUp?.(event)
  }

  const handlePointerLeave: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    setPressed(false)
    onPointerLeave?.(event)
  }

  const buttonStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    cursor: interactive ? 'pointer' : 'default',
    ...style,
    transition: `background-color 60ms${style?.transition ? `, ${style.transition}` : ''}`,
  }

  const contentStyle: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: pressed ? `scale(${pressedScale})` : 'scale(1)',
    transition: 'transform 80ms ease-out',
  }

  const backgroundStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    background: hovered && hoverBackground ? hoverBackground : style?.background,
    transform: pressed ? `scale(${pressedScale})` : 'scale(1)',
    transition: 'transform 80ms ease-out, background-color 60ms',
    pointerEvents: 'none',
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', ...wrapperStyle }}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        className={className}
        style={buttonStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        aria-label={ariaLabel}
        aria-keyshortcuts={ariaKeyShortcuts}
        {...props}
      >
        <span style={backgroundStyle} />
        <span style={contentStyle}>
          {children}
        </span>
      </button>
      {tooltipVisible && createPortal(
        <ActionIconTooltip anchorRect={tooltipRect}>
          {shortcut
            ? <ToolTape label={tooltip ?? shortcutLabel} shortcut={shortcut} />
            : tooltip}
        </ActionIconTooltip>,
        document.body,
      )}
    </span>
  )
}
