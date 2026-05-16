import { ClipboardList, FileText, Globe2, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { isPlanMarkdownPath } from '../planMetadata'
import { resourceTitle } from './resource-preview/resourceUri'
import type { ResourceRef } from './resource-preview/types'

const REFERENCE_BG = 'rgb(231, 239, 251)'
const REFERENCE_TEXT = 'rgb(64, 117, 208)'

type Props = {
  resource?: ResourceRef | null
  label?: string
  onRemove?: () => void
  onClick?: () => void
  compact?: boolean
  title?: string
  style?: CSSProperties
}

function resourcePath(resource: ResourceRef | null | undefined): string | undefined {
  if (!resource) return undefined
  if (resource.kind === 'local-file') return resource.path
  if (resource.kind === 'workspace-file') return resource.path
  if (resource.kind === 'artifact') return resource.filename
  return resource.url
}

function iconForResource(resource: ResourceRef | null | undefined, label: string, compact: boolean) {
  const size = compact ? 14 : 16
  const path = resourcePath(resource) ?? label
  if (isPlanMarkdownPath(path)) {
    return <ClipboardList size={size} strokeWidth={1.8} style={{ color: REFERENCE_TEXT, flexShrink: 0 }} />
  }
  if (resource?.kind === 'browser') {
    return <Globe2 size={size} strokeWidth={1.8} style={{ color: REFERENCE_TEXT, flexShrink: 0 }} />
  }
  return <FileText size={size} strokeWidth={1.8} style={{ color: REFERENCE_TEXT, flexShrink: 0 }} />
}

export function ResourceReferenceChip({ resource, label, onRemove, onClick, compact = false, title, style }: Props) {
  const displayLabel = label ?? (resource ? resourceTitle(resource) : 'file')
  const clickable = !!onClick
  return (
    <span
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!clickable) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick?.()
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? '6px' : '8px',
        maxWidth: '100%',
        height: compact ? '24px' : '32px',
        padding: onRemove ? (compact ? '0 4px 0 8px' : '0 5px 0 10px') : (compact ? '0 9px' : '0 11px'),
        borderRadius: compact ? '6.5px' : '8px',
        background: REFERENCE_BG,
        border: '0.5px solid transparent',
        color: REFERENCE_TEXT,
        fontSize: compact ? '14px' : '14px',
        fontWeight: 430,
        lineHeight: compact ? '20px' : 1,
        cursor: clickable ? 'pointer' : 'default',
        verticalAlign: 'middle',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {iconForResource(resource, displayLabel, compact)}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: compact ? '20px' : undefined }}>
        {displayLabel}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: compact ? '18px' : '20px',
            height: compact ? '18px' : '20px',
            border: 'none',
            borderRadius: '5px',
            padding: 0,
            background: 'transparent',
            color: REFERENCE_TEXT,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={compact ? 13 : 14} strokeWidth={1.9} />
        </button>
      )}
    </span>
  )
}
