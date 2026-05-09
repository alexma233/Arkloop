import type { CopBlockItem } from './assistantTurnSegments'
import { normalizeToolName, compactCommandLine, presentationForTool, basename, truncate, EXPLORE_TOOL_NAMES, LOAD_TOOL_NAMES, LSP_MUTATING_OPERATIONS } from './toolPresentation'
import { isWebSearchToolName, webSearchQueriesFromArguments } from './webSearchTimelineFromAgentEvent'
import { planDisplayNameFromArgs } from './planMetadata'
import { isWebFetchToolName } from './agentEventProcessing'

export type CopSegmentCategory = 'explore' | 'exec' | 'edit' | 'agent' | 'fetch' | 'search' | 'image' | 'generic'

export type CopSubSegment = {
  id: string
  category: CopSegmentCategory
  status: 'open' | 'closed'
  items: CopBlockItem[]
  seq: number
  title: string  // flat string for serialization/compatibility
  titleSpans?: TitleSpan[]  // structured spans for color rendering (optional)
}

export type TitleSpan =
  | { text: string }
  | { text: string; diffKind: 'added' | 'removed' }

export function titleSpansToText(spans: TitleSpan[]): string {
  return spans.map(s => s.text).join('')
}

export function joinTitleSpans(spans: TitleSpan[], separator: string): TitleSpan[] {
  const result: TitleSpan[] = []
  for (let i = 0; i < spans.length; i++) {
    if (i > 0) result.push({ text: separator })
    result.push(spans[i]!)
  }
  return result
}

export const EXEC_TOOL_NAMES = new Set(['exec_command', 'python_execute', 'continue_process', 'terminate_process'])
export const EDIT_TOOL_NAMES = new Set(['edit', 'edit_file', 'write_file'])
export const AGENT_TOOL_NAMES = new Set([
  'spawn_agent',
  'send_input', 'wait_agent', 'resume_agent', 'close_agent', 'interrupt_agent',
])
export const TODO_TOOL_NAMES = new Set(['todo_write'])
// 仅 todo_write 仍需提升到顶层；exec 工具现已归入 COP timeline 作为 exec 子段渲染
export const TOP_LEVEL_TOOL_NAMES = new Set(['todo_write'])
export const FILE_OP_TOOL_NAMES = new Set([
  'grep', 'glob', 'read_file', 'read', 'write_file', 'edit', 'edit_file',
  'load_tools', 'load_skill', 'lsp',
  'memory_write', 'memory_edit', 'memory_search', 'memory_read', 'memory_forget',
  'notebook_write', 'notebook_read', 'notebook_edit', 'notebook_forget',
])
export const IMAGE_GENERATE_TOOL_NAME = 'image_generate'

export function categoryForTool(toolName: string): CopSegmentCategory {
  const n = normalizeToolName(toolName)
  if (isWebSearchToolName(toolName)) return 'search'
  if (EXPLORE_TOOL_NAMES.has(n)) {
    if (n === 'lsp' && LSP_MUTATING_OPERATIONS.has(toolName)) return 'edit'
    return 'explore'
  }
  if (EXEC_TOOL_NAMES.has(n)) return 'exec'
  if (EDIT_TOOL_NAMES.has(n)) return 'edit'
  if (AGENT_TOOL_NAMES.has(n)) return 'agent'
  if (isWebFetchToolName(toolName)) return 'fetch'
  if (isImageGenerateToolName(toolName)) return 'image'
  return 'generic'
}

export function segmentLiveTitle(cat: CopSegmentCategory): string {
  switch (cat) {
    case 'explore': return 'Exploring code...'
    case 'exec': return 'Running...'
    case 'edit': return 'Editing...'
    case 'agent': return 'Agent running...'
    case 'fetch': return 'Fetching...'
    case 'search': return 'Searching...'
    case 'image': return `${imageGenerateTitle('live')}...`
    case 'generic': return 'Working...'
  }
}

function isLoadTool(toolName: string): boolean {
  return LOAD_TOOL_NAMES.has(normalizeToolName(toolName))
}

function isImageGenerateToolName(toolName: string): boolean {
  return normalizeToolName(toolName) === IMAGE_GENERATE_TOOL_NAME
}

function imageGenerateTitle(status: 'live' | 'success' | 'failed'): string {
  switch (status) {
    case 'live': return 'Generating image'
    case 'success': return 'Generated image'
    case 'failed': return 'Image generation failed'
  }
}

function imageGenerateDoneTitle(total: number, failed: number): string {
  if (failed > 0) return failed === 1 ? 'Image generation failed' : `${failed} image generations failed`
  return total === 1 ? imageGenerateTitle('success') : `Generated ${total} images`
}

function imageGenerateCallsTitle(calls: ReadonlyArray<CallItem['call']>): string | null {
  if (calls.length === 0) return null
  if (!calls.every((call) => isImageGenerateToolName(call.toolName))) return null
  const failed = calls.filter((call) => typeof call.errorClass === 'string' && call.errorClass.trim() !== '').length
  return imageGenerateDoneTitle(calls.length, failed)
}

function countLoadToolsCall(call: CallItem['call']): number {
  const result = call.result && typeof call.result === 'object' && !Array.isArray(call.result)
    ? call.result as Record<string, unknown>
    : null
  if (result) {
    if (typeof result.count === 'number') return Math.max(0, result.count)
    if (Array.isArray(result.matched)) return result.matched.length
  }
  const queries = Array.isArray(call.arguments?.queries) ? call.arguments.queries.length : 0
  return Math.max(1, queries)
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatLoadToolsTitle(loadToolsCount: number, loadSkillCount: number, tense: 'live' | 'done'): string {
  const verb = tense === 'live' ? 'Loading' : 'Loaded'
  const parts: string[] = []
  if (loadToolsCount > 0) parts.push(formatCount(loadToolsCount, 'tool', 'tools'))
  if (loadSkillCount > 0) parts.push(formatCount(loadSkillCount, 'skill', 'skills'))
  return parts.length > 0 ? `${verb} ${parts.join(', ')}` : `${verb} 0 tools`
}

export function segmentCompletedTitle(seg: CopSubSegment): TitleSpan[] {
  const calls = seg.items
    .filter((i): i is Extract<CopBlockItem, { kind: 'call' }> => i.kind === 'call')
    .map((i) => i.call)
  if (calls.length === 0) return [{ text: 'Completed' }]

  const imageTitle = imageGenerateCallsTitle(calls)
  if (imageTitle) return [{ text: imageTitle }]

  switch (seg.category) {
    case 'explore': {
      const readCalls = calls.filter((c) => normalizeToolName(c.toolName) === 'read_file')
      const readPaths = new Set(readCalls.map((c) => {
        const path = c.arguments?.file_path as string | undefined
          ?? (c.arguments?.source as { file_path?: string } | undefined)?.file_path
        return path || c.toolCallId
      }))
      const searchCount = calls.filter((c) => {
        const n = normalizeToolName(c.toolName)
        return n === 'grep' || n === 'lsp'
      }).length
      const globCount = calls.filter((c) => normalizeToolName(c.toolName) === 'glob').length
      const loadToolsCount = calls
        .filter((c) => normalizeToolName(c.toolName) === 'load_tools')
        .reduce((count, call) => count + countLoadToolsCall(call), 0)
      const loadSkillCount = calls.filter((c) => normalizeToolName(c.toolName) === 'load_skill').length
      if (calls.every((c) => isLoadTool(c.toolName))) {
        return [{ text: formatLoadToolsTitle(loadToolsCount, loadSkillCount, 'done') }]
      }
      const parts: string[] = []
      if (readPaths.size > 0) parts.push(`Read ${readPaths.size} file${readPaths.size === 1 ? '' : 's'}`)
      if (searchCount > 0) parts.push(`${searchCount} search${searchCount === 1 ? '' : 'es'}`)
      if (globCount > 0) parts.push(`Listed ${globCount} file${globCount === 1 ? '' : 's'}`)
      return parts.length > 0 ? [{ text: parts.join(', ') }] : [{ text: 'Explored code' }]
    }
    case 'exec': {
      const n = calls.length
      return [{ text: `${n} step${n === 1 ? '' : 's'} completed` }]
    }
    case 'edit': {
      const stats = aggregateCallStats(calls)
      const spans = formatStatsSpans(stats)
      return spans.length > 0 ? spans : [{ text: 'Edit completed' }]
    }
    case 'agent': {
      const n = calls.length
      return [{ text: n === 1 ? 'Agent completed' : `${n} agent tasks completed` }]
    }
    case 'fetch': return [{ text: 'Fetch completed' }]
    case 'search': return [{ text: webSearchCompletedTitle(calls) }]
    case 'image': return [{ text: imageGenerateCallsTitle(calls) ?? imageGenerateTitle('success') }]
    case 'generic': {
      if (calls.length === 1) {
        const call = calls[0]!
        if (call.toolName === 'exit_plan_mode') return [{ text: presentationForTool(call.toolName, call.arguments).description }]
        const t = call.toolName
        // Map known generic tool names to readable labels
        const label: Record<string, string> = {
          todo_write: 'Updated todos',
          todo_read: 'Read todos',
        }
        return [{ text: label[t] ?? t }]
      }
      return [{ text: `${calls.length} steps completed` }]
    }
  }
}

// 聚合统计：跨 segment 收集所有 tool call 的分类计数
export type AggregatedCallStats = {
  readPaths: Set<string>
  searchCount: number
  globCount: number
  writePaths: string[]
  editPaths: string[]
  writePathDiff: Map<string, { added: number; removed: number }>
  editPathDiff: Map<string, { added: number; removed: number }>
  execCount: number
  agentCount: number
  fetchCount: number
  webSearchCount: number
  webSearchQueries: string[]
  loadToolsCount: number
  loadSkillCount: number
  imageCount: number
  imageFailedCount: number
  genericCount: number
  byToolName: Map<string, number>
}

type CallItem = Extract<CopBlockItem, { kind: 'call' }>

function getReadPath(c: CallItem['call']): string {
  const direct = c.arguments?.file_path as string | undefined
  if (typeof direct === 'string' && direct) return direct
  const source = c.arguments?.source as { file_path?: string } | undefined
  if (source && typeof source.file_path === 'string' && source.file_path) return source.file_path
  return c.toolCallId
}

function extractCallDiff(call: CallItem['call']): { added: number; removed: number } | null {
  const n = normalizeToolName(call.toolName)
  // write_file: diff = content line count
  if (n === 'write_file') {
    const content = typeof call.arguments.content === 'string' ? call.arguments.content : ''
    if (!content) return null
    const lines = content.replace(/\r\n/g, '\n').split('\n').length
    return lines > 0 ? { added: lines, removed: 0 } : null
  }
  // edit / edit_file: diff from result.diff/patch/unified_diff
  const result = call.result
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const text = typeof r.diff === 'string' ? r.diff
    : typeof r.patch === 'string' ? r.patch
    : typeof r.unified_diff === 'string' ? r.unified_diff
    : ''
  if (!text) return null
  let added = 0
  let removed = 0
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return added > 0 || removed > 0 ? { added, removed } : null
}

function getEditPath(c: CallItem['call']): string {
  const planName = planDisplayNameFromArgs(c.arguments ?? {})
  if (planName) return planName
  const p = c.arguments?.file_path
  return typeof p === 'string' ? p : ''
}

export function aggregateCallStats(calls: ReadonlyArray<CallItem['call']>): AggregatedCallStats {
  const stats: AggregatedCallStats = {
    readPaths: new Set<string>(),
    searchCount: 0,
    globCount: 0,
    writePaths: [],
    editPaths: [],
    writePathDiff: new Map(),
    editPathDiff: new Map(),
    execCount: 0,
    agentCount: 0,
    fetchCount: 0,
    webSearchCount: 0,
    webSearchQueries: [],
    loadToolsCount: 0,
    loadSkillCount: 0,
    imageCount: 0,
    imageFailedCount: 0,
    genericCount: 0,
    byToolName: new Map<string, number>(),
  }
  for (const c of calls) {
    const n = normalizeToolName(c.toolName)
    stats.byToolName.set(n, (stats.byToolName.get(n) ?? 0) + 1)
    const cat = categoryForTool(c.toolName)
    if (n === 'read_file') {
      stats.readPaths.add(getReadPath(c))
      continue
    }
    if (n === 'grep') { stats.searchCount += 1; continue }
    if (n === 'glob') { stats.globCount += 1; continue }
    if (n === 'load_tools') { stats.loadToolsCount += countLoadToolsCall(c); continue }
    if (n === 'load_skill') { stats.loadSkillCount += 1; continue }
    if (n === 'lsp') {
      // rename 算 edit，其余算 search
      const op = typeof c.arguments?.operation === 'string' ? c.arguments.operation : ''
      if (LSP_MUTATING_OPERATIONS.has(op)) {
        const fp = typeof c.arguments?.file_path === 'string' ? c.arguments.file_path : ''
        stats.editPaths.push(fp ? basename(fp) : c.toolCallId)
      } else {
        stats.searchCount += 1
      }
      continue
    }
    if (cat === 'edit') {
      const fp = getEditPath(c)
      const target = fp ? basename(fp) : c.toolCallId
      const diff = extractCallDiff(c)
      if (n === 'write_file') {
        stats.writePaths.push(target)
        if (diff) stats.writePathDiff.set(target, diff)
      } else {
        stats.editPaths.push(target)
        if (diff) stats.editPathDiff.set(target, diff)
      }
      continue
    }
    if (cat === 'search') {
      stats.webSearchCount += 1
      const queries = webSearchQueriesFromArguments(c.arguments) ?? []
      for (const query of queries) {
        if (!stats.webSearchQueries.includes(query)) stats.webSearchQueries.push(query)
      }
      continue
    }
    if (cat === 'exec') { stats.execCount += 1; continue }
    if (cat === 'agent') { stats.agentCount += 1; continue }
    if (cat === 'fetch') { stats.fetchCount += 1; continue }
    if (cat === 'image') {
      stats.imageCount += 1
      if (typeof c.errorClass === 'string' && c.errorClass.trim() !== '') stats.imageFailedCount += 1
      continue
    }
    stats.genericCount += 1
  }
  return stats
}


function uniqueWebSearchQueries(calls: ReadonlyArray<CallItem['call']>): string[] {
  const seen = new Set<string>()
  const queries: string[] = []
  for (const call of calls) {
    const fromArgs = webSearchQueriesFromArguments(call.arguments) ?? []
    for (const q of fromArgs) {
      if (seen.has(q)) continue
      seen.add(q)
      queries.push(q)
    }
  }
  return queries
}

function formatWebSearchTitle(prefix: 'Searching for' | 'Searched for', queries: ReadonlyArray<string>): string | null {
  if (queries.length === 0) return null
  const first = truncate(queries[0]!, 64)
  return queries.length === 1 ? `${prefix} ${first}` : `${prefix} ${first} +${queries.length - 1}`
}

function webSearchLiveTitle(args: Record<string, unknown>): string {
  return formatWebSearchTitle('Searching for', webSearchQueriesFromArguments(args) ?? []) ?? 'Searching'
}

function webFetchLiveTitle(args: Record<string, unknown>): string {
  const url = typeof args.url === 'string' ? args.url.trim() : ''
  if (!url) return 'Fetching page'
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host ? `Fetching ${truncate(host, 48)}` : 'Fetching page'
  } catch {
    return 'Fetching page'
  }
}

function webSearchCompletedTitle(calls: ReadonlyArray<CallItem['call']>): string {
  const byQuery = formatWebSearchTitle('Searched for', uniqueWebSearchQueries(calls))
  if (byQuery) return byQuery
  return calls.length === 1 ? 'Search completed' : `${calls.length} searches completed`
}

function webSearchStatsTitle(stats: AggregatedCallStats): string | null {
  if (stats.webSearchCount <= 0) return null
  return formatWebSearchTitle('Searched for', stats.webSearchQueries)
    ?? (stats.webSearchCount === 1 ? 'Search completed' : `${stats.webSearchCount} searches completed`)
}

function lspProgressive(args: Record<string, unknown>): string {
  const op = typeof args.operation === 'string' ? args.operation : ''
  const query = typeof args.query === 'string' ? args.query : ''
  const filePath = typeof args.file_path === 'string' ? args.file_path : ''
  const subject = query || (filePath ? basename(filePath) : '')
  switch (op) {
    case 'definition': return subject ? `Finding definition in ${subject}` : 'Finding definition'
    case 'references': return subject ? `Finding references in ${subject}` : 'Finding references'
    case 'hover': return subject ? `Inspecting symbol in ${subject}` : 'Inspecting symbol'
    case 'document_symbols': return subject ? `Listing symbols in ${subject}` : 'Listing symbols'
    case 'workspace_symbols': return query ? `Searching symbols for ${truncate(query, 36)}` : 'Searching symbols'
    case 'type_definition': return subject ? `Finding type definition in ${subject}` : 'Finding type definition'
    case 'implementation': return subject ? `Finding implementations in ${subject}` : 'Finding implementations'
    case 'diagnostics': return subject ? `Checking diagnostics in ${subject}` : 'Checking diagnostics'
    case 'rename': return subject ? `Renaming symbol in ${subject}` : 'Renaming symbol'
    default: return op ? `Running LSP ${op}` : 'Running LSP'
  }
}

export function runningToolLabel(
  toolNameInput: string,
  args: Record<string, unknown> = {},
  displayDescription?: string,
): string {
  const dd = (displayDescription ?? '').trim()
  if (isWebSearchToolName(toolNameInput)) return webSearchLiveTitle(args)
  if (isWebFetchToolName(toolNameInput)) return webFetchLiveTitle(args)
  const toolName = normalizeToolName(toolNameInput)
  if (toolName === IMAGE_GENERATE_TOOL_NAME) return imageGenerateTitle('live')
  if (dd) return dd
  switch (toolName) {
    case 'read_file': {
      const path = (typeof args.file_path === 'string' && args.file_path)
        || ((args.source as { file_path?: string } | undefined)?.file_path ?? '')
      return path ? `Reading ${truncate(basename(path), 48)}` : 'Reading file'
    }
    case 'grep': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : ''
      return pattern ? `Searching ${truncate(pattern, 48)}` : 'Searching code'
    }
    case 'glob': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : ''
      return pattern ? `Listing ${truncate(pattern, 48)}` : 'Listing files'
    }
    case 'edit':
    case 'edit_file': {
      const fp = typeof args.file_path === 'string' ? args.file_path : ''
      return fp ? `Editing ${truncate(basename(fp), 48)}` : 'Editing file'
    }
    case 'write_file': {
      const fp = typeof args.file_path === 'string' ? args.file_path : ''
      return fp ? `Writing ${truncate(basename(fp), 48)}` : 'Writing file'
    }
    case 'exec_command':
    case 'continue_process':
    case 'terminate_process':
    case 'python_execute': {
      const cmd = (typeof args.cmd === 'string' && args.cmd)
        || (typeof args.command === 'string' && args.command)
        || (typeof args.code === 'string' && args.code) || ''
      if (cmd) return truncate(compactCommandLine(cmd.split('\n')[0]!.trim()), 72)
      return 'Running command'
    }
    case 'load_tools': return 'Loading tools'
    case 'load_skill': return 'Loading skill'
    case 'lsp': return lspProgressive(args)
    default: return toolName
  }
}

function formatDiffSpans(path: string, diffMap: Map<string, { added: number; removed: number }>): TitleSpan[] {
  const d = diffMap.get(path)
  if (!d) return []
  const spans: TitleSpan[] = []
  if (d.added > 0) spans.push({ text: ` +${d.added}`, diffKind: 'added' })
  if (d.removed > 0) spans.push({ text: ` -${d.removed}`, diffKind: 'removed' })
  return spans
}

export function formatStatsSpans(stats: AggregatedCallStats): TitleSpan[] {
  const onlyLoadTools = Array.from(stats.byToolName.keys()).every((toolName) => LOAD_TOOL_NAMES.has(toolName))
  const groups: TitleSpan[][] = []

  if (stats.writePaths.length === 1) {
    const spans: TitleSpan[] = [{ text: `Wrote ${stats.writePaths[0]}` }]
    spans.push(...formatDiffSpans(stats.writePaths[0]!, stats.writePathDiff))
    groups.push(spans)
  } else if (stats.writePaths.length > 1) {
    groups.push([{ text: `Wrote ${stats.writePaths.length} files` }])
  }
  if (stats.editPaths.length === 1) {
    const spans: TitleSpan[] = [{ text: `Edited ${stats.editPaths[0]}` }]
    spans.push(...formatDiffSpans(stats.editPaths[0]!, stats.editPathDiff))
    groups.push(spans)
  } else if (stats.editPaths.length > 1) {
    groups.push([{ text: `Edited ${stats.editPaths.length} files` }])
  }
  if (stats.readPaths.size > 0) groups.push([{ text: `Read ${formatCount(stats.readPaths.size, 'file', 'files')}` }])
  if (stats.searchCount > 0) groups.push([{ text: formatCount(stats.searchCount, 'search', 'searches') }])
  if (stats.globCount > 0) groups.push([{ text: `Listed ${formatCount(stats.globCount, 'file', 'files')}` }])
  if (groups.length === 0 && onlyLoadTools) {
    groups.push([{ text: formatLoadToolsTitle(stats.loadToolsCount, stats.loadSkillCount, 'done') }])
  }
  if (stats.execCount > 0) groups.push([{ text: `Ran ${formatCount(stats.execCount, 'command', 'commands')}` }])
  if (stats.agentCount > 0) groups.push([{ text: formatCount(stats.agentCount, 'agent task', 'agent tasks') }])
  if (stats.fetchCount > 0) groups.push([{ text: formatCount(stats.fetchCount, 'fetch', 'fetches') }])
  if (stats.imageCount > 0) groups.push([{ text: imageGenerateDoneTitle(stats.imageCount, stats.imageFailedCount) }])
  const webSearchTitle = webSearchStatsTitle(stats)
  if (webSearchTitle) groups.push([{ text: webSearchTitle }])

  const filtered = groups.filter(g => g.length > 0)
  if (filtered.length === 0) return []
  const result: TitleSpan[] = []
  for (let i = 0; i < filtered.length; i++) {
    if (i > 0) result.push({ text: ', ' })
    result.push(...filtered[i]!)
  }
  return result
}

function formatStatsParts(stats: AggregatedCallStats): string {
  return titleSpansToText(formatStatsSpans(stats))
}

function formatSingleCategoryTitle(cat: CopSegmentCategory, stats: AggregatedCallStats, total: number): string {
  switch (cat) {
    case 'explore': {
      const parts = formatStatsParts(stats)
      return parts || 'Explored code'
    }
    case 'exec':
      return `${formatCount(stats.execCount, 'step', 'steps')} completed`
    case 'edit': {
      if (stats.writePaths.length > 0 && stats.editPaths.length > 0) {
        return formatStatsParts(stats)
      }
      if (stats.writePaths.length > 0 && stats.editPaths.length === 0) {
        if (stats.writePaths.length === 1) return `Wrote ${stats.writePaths[0]}${titleSpansToText(formatDiffSpans(stats.writePaths[0]!, stats.writePathDiff))}`
        return `Wrote ${stats.writePaths.length} files`
      }
      if (stats.editPaths.length === 1) return `Edited ${stats.editPaths[0]}${titleSpansToText(formatDiffSpans(stats.editPaths[0]!, stats.editPathDiff))}`
      if (stats.editPaths.length > 1) return `Edited ${stats.editPaths.length} files`
      return 'Edit completed'
    }
    case 'agent':
      return stats.agentCount === 1 ? 'Agent completed' : `${stats.agentCount} agent tasks completed`
    case 'fetch':
      return stats.fetchCount === 1 ? 'Fetch completed' : `${stats.fetchCount} fetches completed`
    case 'search':
      return webSearchStatsTitle(stats) ?? 'Search completed'
    case 'image':
      return imageGenerateDoneTitle(total, stats.imageFailedCount)
    case 'generic':
      return `${formatCount(total, 'step', 'steps')} completed`
  }
}

function collectCalls(segs: ReadonlyArray<CopSubSegment>): CallItem['call'][] {
  const out: CallItem['call'][] = []
  for (const s of segs) {
    for (const it of s.items) {
      if (it.kind === 'call') out.push(it.call)
    }
  }
  return out
}

function buildLiveMainTitle(segments: ReadonlyArray<CopSubSegment>): TitleSpan[] {
  // 找最后一个 open（或最后一段）的最后一个 call
  let openSeg: CopSubSegment | null = null
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i]!.status === 'open') { openSeg = segments[i]!; break }
  }
  if (!openSeg) openSeg = segments[segments.length - 1]!
  let lastCall: CallItem['call'] | null = null
  for (let i = openSeg.items.length - 1; i >= 0; i--) {
    const it = openSeg.items[i]!
    if (it.kind === 'call') { lastCall = it.call; break }
  }
  const openCalls = openSeg.items
    .filter((it): it is CallItem => it.kind === 'call')
    .map((it) => it.call)
  const current = (() => {
    if (!lastCall) return segmentLiveTitle(openSeg.category).replace(/\.\.\.$/, '')
    if (openCalls.length > 0 && openCalls.every((call) => isLoadTool(call.toolName))) {
      const stats = aggregateCallStats(openCalls)
      return formatLoadToolsTitle(stats.loadToolsCount, stats.loadSkillCount, 'live')
    }
    if (isLoadTool(lastCall.toolName)) return segmentLiveTitle(openSeg.category).replace(/\.\.\.$/, '')
    return runningToolLabel(lastCall.toolName, lastCall.arguments, lastCall.displayDescription)
  })()
  const closedSegs = segments.filter((s) => s !== openSeg && s.status === 'closed')
  const closedCalls = collectCalls(closedSegs)
  if (closedCalls.length === 0) return [{ text: `${current}...` }]
  const stats = aggregateCallStats(closedCalls)
  const history = formatStatsSpans(stats)
  if (history.length === 0) return [{ text: `${current}...` }]
  return [...history, { text: ` · ${current}...` }]
}

function buildCompleteMainTitle(segments: ReadonlyArray<CopSubSegment>): TitleSpan[] {
  const allCalls = collectCalls(segments)
  if (allCalls.length === 1 && allCalls[0]!.toolName === 'exit_plan_mode') {
    return [{ text: presentationForTool(allCalls[0]!.toolName, allCalls[0]!.arguments).description }]
  }
  if (allCalls.length === 0) {
    // 退化路径：没有真实 call（例如 segments 仅作为 title 占位），沿用旧 segment.title 行为
    if (segments.length > 1) return [{ text: `${segments.length} steps completed` }]
    return [{ text: segments[0]!.title || 'Completed' }]
  }
  const stats = aggregateCallStats(allCalls)
  const imageTitle = imageGenerateCallsTitle(allCalls)
  if (imageTitle) return [{ text: imageTitle }]
  const cats = Array.from(new Set(segments.map((s) => s.category)))
  if (cats.length === 1) return [{ text: formatSingleCategoryTitle(cats[0]!, stats, allCalls.length) }]
  const parts = formatStatsSpans(stats)
  return parts.length > 0 ? parts : [{ text: `${formatCount(allCalls.length, 'step', 'steps')} completed` }]
}

/**
 * 聚合整个 COP 的主标题。
 * Live 态：取最后 open 段的最后一个 running tool 的渐进式标签，前面拼接已完成段的历史统计，
 *   例如 "Read 3 files · Searching auth flow..."——让用户同时看到进度和已完成工作。
 * Complete 态：跨段聚合所有 call，单类别输出该类别摘要，多类别输出跨类别统计。
 */
export function aggregateMainTitle(
  segments: ReadonlyArray<CopSubSegment>,
  isLive: boolean,
  isComplete: boolean,
): TitleSpan[] {
  if (segments.length === 0) return []
  if (isLive && !isComplete) return buildLiveMainTitle(segments)
  return buildCompleteMainTitle(segments)
}

/**
 * 将 COP 内的 items 按类别分组为子段。
 * 连续同类别 tool.call 合并为一个 SubSegment；类别变化时关闭当前段、开启新段。
 * call 之前的 thinking/assistant_text 作为 pendingLead 暂存，延迟挂入第一个 tool segment——
 * 避免在尚无工具信息的阶段就孤立展示思考内容。
 */
export function buildSubSegments(items: CopBlockItem[]): CopSubSegment[] {
  const segments: CopSubSegment[] = []
  let currentItems: CopBlockItem[] = []
  let currentCat: CopSegmentCategory | null = null
  let pendingLead: CopBlockItem[] = [] // think/text before any tool call

  const closeCurrent = () => {
    if (currentItems.length === 0 && pendingLead.length === 0) return
    if (currentCat == null) return
    const allItems = [...pendingLead, ...currentItems]
    if (allItems.length === 0) return
    const seg: CopSubSegment = {
      id: `seg-${segments.length}`,
      category: currentCat,
      status: 'closed',
      items: allItems,
      seq: allItems[0]?.seq ?? 0,
      title: segmentLiveTitle(currentCat),
    }
    const spans = segmentCompletedTitle(seg)
    seg.title = titleSpansToText(spans)
    seg.titleSpans = spans
    segments.push(seg)
    currentItems = []
    currentCat = null
    pendingLead = []
  }

  for (const item of items) {
    if (item.kind === 'call') {
      const cat = categoryForTool(item.call.toolName)
      if (currentCat !== null && cat !== currentCat) {
        closeCurrent()
      }
      if (currentCat === null) {
        currentCat = cat
        currentItems = []
      }
      currentItems.push(item)
    } else {
      // thinking or assistant_text
      if (currentCat !== null) {
        currentItems.push(item)
      } else {
        pendingLead.push(item)
      }
    }
  }

  closeCurrent()

  return segments
}

// -- Resolved pool builder --

import type { CopTimelinePayload } from './copSegmentTimeline'

function mapById<T extends { id: string }>(arr: T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const item of arr) m.set(item.id, item)
  return m
}

export type ResolvedPool = {
  codeExecutions: Map<string, import('./storage').CodeExecutionRef>
  fileOps: Map<string, import('./storage').FileOpRef>
  webFetches: Map<string, import('./storage').WebFetchRef>
  subAgents: Map<string, import('./storage').SubAgentRef>
  genericTools: Map<string, import('./copSegmentTimeline').GenericToolCallRef>
  steps: Map<string, import('./components/cop-timeline/types').WebSearchPhaseStep>
  sources: import('./storage').WebSource[]
}

export function buildResolvedPool(payload: CopTimelinePayload): ResolvedPool {
  const fileOps = new Map<string, import('./storage').FileOpRef>()
  for (const op of payload.fileOps ?? []) fileOps.set(op.id, op)
  for (const group of payload.exploreGroups ?? []) {
    for (const op of group.items) fileOps.set(op.id, op)
  }
  return {
    codeExecutions: mapById(payload.codeExecutions ?? []),
    fileOps,
    webFetches: mapById(payload.webFetches ?? []),
    subAgents: mapById(payload.subAgents ?? []),
    genericTools: mapById(payload.genericTools ?? []),
    steps: mapById(payload.steps),
    sources: payload.sources,
  }
}

function emptyMap<K extends string, V>(): Map<K, V> {
  return new Map<K, V>()
}

export const EMPTY_POOL: ResolvedPool = {
  codeExecutions: emptyMap(),
  fileOps: emptyMap(),
  webFetches: emptyMap(),
  subAgents: emptyMap(),
  genericTools: emptyMap(),
  steps: emptyMap(),
  sources: [],
}

export function buildFallbackSegments(tools: {
  codeExecutions?: Array<{ id: string; seq?: number }> | null
  subAgents?: Array<{ id: string; seq?: number }> | null
  fileOps?: Array<{ id: string; toolName: string; seq?: number }> | null
  webFetches?: Array<{ id: string; seq?: number }> | null
}): CopSubSegment[] {
  const segs: CopSubSegment[] = []
  const allTools: Array<{ id: string; toolName: string; seq?: number }> = []
  if (tools.codeExecutions) {
    for (const c of tools.codeExecutions) allTools.push({ id: c.id, toolName: 'exec_command', seq: c.seq })
  }
  if (tools.subAgents) {
    for (const a of tools.subAgents) allTools.push({ id: a.id, toolName: 'spawn_agent', seq: a.seq })
  }
  if (tools.fileOps) {
    for (const f of tools.fileOps) allTools.push({ id: f.id, toolName: f.toolName, seq: f.seq })
  }
  if (tools.webFetches) {
    for (const w of tools.webFetches) allTools.push({ id: w.id, toolName: 'web_fetch', seq: w.seq })
  }
  allTools.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  if (allTools.length === 0) return segs

  const items: CopBlockItem[] = allTools.map((t) => ({
    kind: 'call' as const,
    call: { toolCallId: t.id, toolName: t.toolName, arguments: {} as Record<string, unknown> },
    seq: t.seq ?? 0,
  }))

  segs.push({
    id: 'fallback-tools',
    category: 'generic',
    status: 'closed',
    items,
    seq: items[0]?.seq ?? 0,
    title: `${allTools.length} step${allTools.length === 1 ? '' : 's'} completed`,
  })
  return segs
}

export function buildThinkingOnlyFromItems(items: { kind: string; content?: string; seq: number; startedAtMs?: number; endedAtMs?: number }[]): { markdown: string; live?: boolean; durationSec: number; startedAtMs?: number } | null {
  let markdown = ''
  let live = false
  let startedAtMs: number | undefined
  let endedAtMs: number | undefined
  for (const item of items) {
    if (item.kind === 'thinking' && item.content) {
      markdown += item.content
      if (item.endedAtMs == null) live = true
      if (startedAtMs == null && item.startedAtMs != null) startedAtMs = item.startedAtMs
      if (item.endedAtMs != null) endedAtMs = item.endedAtMs
    }
  }
  if (!markdown.trim()) return null
  const durationSec = startedAtMs != null && endedAtMs != null
    ? Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000))
    : 0
  return { markdown, live, durationSec, startedAtMs }
}
