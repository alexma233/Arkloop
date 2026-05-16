import { isPlanMarkdownPath } from './planMetadata'
import { filenameFromPath, guessMimeType, normalizeMimeType } from './components/resource-preview/mime'
import { filePathToResourceRef, resourceTitle } from './components/resource-preview/resourceUri'
import type { ResourceRef } from './components/resource-preview/types'

export type MessageResourceReferencePart =
  | { type: 'text'; text: string }
  | { type: 'reference'; label: string; value: string; resource: ResourceRef | null }

const REFERENCE_LINE_RE = /^(\s*)(计划文件|引用文件|Plan file|Referenced file)\s*[:：]\s*(\S.*?)\s*$/i

function normalizeSlashes(value: string): string {
  return value.trim().replace(/\\/g, '/')
}

function stripWrapping(value: string): string {
  return value.trim().replace(/^<(.+)>$/, '$1').replace(/^["'](.+)["']$/, '$1')
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:\//.test(value)
}

export function resourceReferenceLabel(value: string, resource: ResourceRef | null): string {
  if (resource) return resourceTitle(resource)
  const cleaned = normalizeSlashes(stripWrapping(value)).replace(/^file:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/g, '')
  return filenameFromPath(cleaned)
}

export function resourceReferenceValue(resource: ResourceRef): string {
  if (resource.kind === 'local-file') {
    const root = normalizeSlashes(resource.rootPath).replace(/\/+$/g, '')
    const path = normalizeSlashes(resource.path).replace(/^\/+/g, '')
    return path ? `${root}/${path}` : root
  }
  if (resource.kind === 'workspace-file') return resource.path.replace(/^\/+/g, '')
  if (resource.kind === 'artifact') return resource.filename ?? resource.key
  return resource.url
}

export function resourceFromReferenceValue(value: string, workFolder?: string | null): ResourceRef | null {
  const cleaned = stripWrapping(value)
  const normalized = normalizeSlashes(cleaned)
  const direct = filePathToResourceRef(normalized, { workFolder })
  if (direct) return direct
  if (!isAbsolutePath(normalized) && workFolder?.trim()) {
    const path = normalized.replace(/^\.?\//, '')
    const filename = filenameFromPath(path)
    return {
      kind: 'local-file',
      rootPath: workFolder,
      path,
      filename,
      name: filename,
      mimeType: normalizeMimeType(guessMimeType(path), filename),
    }
  }
  return null
}

export function serializeMessageWithResourceReferences(text: string, references: ResourceRef[]): string {
  const trimmed = text.trim()
  const referenceLines = references.map((resource) => {
    const label = isPlanMarkdownPath(resourceReferenceValue(resource)) ? '计划文件' : '引用文件'
    return `${label}：${resourceReferenceValue(resource)}`
  })
  if (referenceLines.length === 0) return trimmed
  if (!trimmed) return referenceLines.join('\n')
  return `${trimmed}\n\n${referenceLines.join('\n')}`
}

export function splitMessageResourceReferences(text: string, workFolder?: string | null): MessageResourceReferencePart[] {
  const parts: MessageResourceReferencePart[] = []
  const lines = text.split(/\r?\n/)
  let pendingText: string[] = []

  const flushText = () => {
    if (pendingText.length === 0) return
    parts.push({ type: 'text', text: pendingText.join('\n') })
    pendingText = []
  }

  for (const line of lines) {
    const match = REFERENCE_LINE_RE.exec(line)
    if (!match) {
      pendingText.push(line)
      continue
    }
    flushText()
    const value = stripWrapping(match[3] ?? '')
    const resource = resourceFromReferenceValue(value, workFolder)
    parts.push({
      type: 'reference',
      value,
      resource,
      label: resourceReferenceLabel(value, resource),
    })
  }
  flushText()
  return parts
}
