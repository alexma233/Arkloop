import { useRef, useEffect, useCallback, useMemo, useState, forwardRef, useImperativeHandle } from 'react'
import { ArrowUp, Mic, X, Check, Loader2, Pencil } from 'lucide-react'
import type { FormEvent } from 'react'
import { type UploadedThreadAttachment } from '../api'
import { useLocale } from '../contexts/LocaleContext'
import { PastedContentModal } from './PastedContentModal'
import type { SettingsTab } from './SettingsModal'
import {
  DEFAULT_PERSONA_KEY,
  SEARCH_PERSONA_KEY,
  WORK_PERSONA_KEY,
  type InputDraftScope,
  readSelectedPersonaKeyFromStorage,
  writeSelectedPersonaKeyToStorage,
  readSelectedModelFromStorage,
  writeSelectedModelToStorage,
  SELECTED_MODEL_CHANGED_EVENT,
  readSelectedReasoningMode,
  writeSelectedReasoningMode,
  readThreadReasoningMode,
  writeThreadReasoningMode,
  readInputDraftText,
  writeInputDraftText,
  readInputHistory,
  appendInputHistory,
} from '../storage'
import type { AppMode } from '../storage'
import { AttachmentCard, PastedContentCard, SlashCommandPopup } from './chat-input'
import type { SlashCommandGroup, SlashCommandItem } from './chat-input'
import { useAudioRecorder } from './chat-input/useAudioRecorder'
import { useAttachments } from './chat-input/useAttachments'
import { PersonaModelBar } from './chat-input/PersonaModelBar'
import { ModelPicker } from './ModelPicker'
import { ActionIconButton } from './ActionIconButton'
import { SHORTCUTS } from '../shortcuts'
import type { ResourceRef } from './resource-preview/types'
import { ComposerEditor, type ComposerEditorHandle, type ComposerSlashState } from './chat-input/ComposerEditor'

export type ChatInputHandle = {
  clear: () => void
  setValue: (text: string) => void
  getValue: () => string
}

export type Attachment = {
  id: string
  file?: File
  name: string
  size: number
  mime_type: string
  preview_url?: string
  status: 'uploading' | 'ready' | 'error'
  uploaded?: UploadedThreadAttachment
  pasted?: { text: string; lineCount: number }
}

type Props = {
  onSubmit: (e: FormEvent<HTMLFormElement>, personaKey: string, modelOverride?: string) => void
  onCancel?: () => void
  placeholder?: string
  disabled?: boolean
  isStreaming?: boolean
  canCancel?: boolean
  cancelSubmitting?: boolean
  variant?: 'welcome' | 'chat'
  searchMode?: boolean
  attachments?: Attachment[]
  onAttachFiles?: (files: File[]) => void
  onPasteContent?: (text: string) => void
  onRemoveAttachment?: (id: string) => void
  accessToken?: string
  onAsrError?: (error: unknown) => void
  onPersonaChange?: (personaKey: string) => void
  onOpenSettings?: (tab: SettingsTab | 'voice') => void
  appMode?: AppMode
  hasMessages?: boolean
  messagesLoading?: boolean
  workThreadId?: string
  queuedEditLabel?: string
  onCancelQueuedEdit?: () => void
  draftOwnerKey?: string | null
  planMode?: boolean
  onTogglePlanMode?: (currentMode: boolean) => Promise<void>
  learningModeEnabled?: boolean
  onToggleLearningMode?: (currentMode: boolean) => Promise<void>
  referenceResource?: ResourceRef | null
}

const SLASH_POPUP_WIDTH = 300
const SLASH_POPUP_VIEWPORT_MARGIN = 8

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isSameDraftDomain(left: InputDraftScope | null, right: InputDraftScope): boolean {
  if (!left) return false
  return left.page === right.page
    && (left.threadId ?? null) === (right.threadId ?? null)
    && left.appMode === right.appMode
    && !!left.searchMode === !!right.searchMode
}

function formatRecordingTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSubmit,
  onCancel,
  placeholder = '输入消息...',
  disabled = false,
  isStreaming = false,
  canCancel = false,
  cancelSubmitting = false,
  variant = 'chat',
  searchMode = false,
  attachments = [],
  onAttachFiles,
  onPasteContent,
  onRemoveAttachment,
  accessToken,
  onAsrError,
  onPersonaChange,
  onOpenSettings,
  appMode,
  hasMessages,
  messagesLoading,
  workThreadId,
  queuedEditLabel,
  onCancelQueuedEdit,
  draftOwnerKey,
  planMode = false,
  onTogglePlanMode,
  learningModeEnabled = false,
  onToggleLearningMode,
  referenceResource = null,
}, ref) {
  const composerEditorRef = useRef<ComposerEditorHandle>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [draft, setDraft] = useState('')
  const [resourceReferences, setResourceReferences] = useState<ResourceRef[]>([])

  const historyRef = useRef<string[]>([])
  const historyCursorRef = useRef(-1)
  const historyDraftRef = useRef('')

  const resetHistoryCursor = useCallback(() => {
    historyCursorRef.current = -1
    historyDraftRef.current = ''
  }, [])

  useImperativeHandle(ref, () => ({
    clear: () => {
      resetHistoryCursor()
      setDraft('')
      setResourceReferences([])
      composerEditorRef.current?.clear()
    },
    setValue: (text: string) => {
      resetHistoryCursor()
      setDraft(text)
      setResourceReferences([])
      composerEditorRef.current?.setValue(text)
    },
    getValue: () => composerEditorRef.current?.getValue() ?? '',
  }), [resetHistoryCursor])

  const valueRef = useRef(draft)
  useEffect(() => { valueRef.current = draft }, [draft])
  const onChangeRef = useRef(setDraft)
  onChangeRef.current = setDraft
  const accessTokenRef = useRef(accessToken)
  accessTokenRef.current = accessToken
  const onAsrErrorRef = useRef(onAsrError)
  onAsrErrorRef.current = onAsrError
  const onVoiceNotConfiguredRef = useRef<(() => void) | undefined>(() => onOpenSettings?.('voice'))
  onVoiceNotConfiguredRef.current = onOpenSettings ? () => onOpenSettings('voice') : undefined

  const { t } = useLocale()

  const [selectedPersonaKey, setSelectedPersonaKey] = useState(readSelectedPersonaKeyFromStorage)
  const [focused, setFocused] = useState(false)
  const [childMenuOpen, setChildMenuOpen] = useState(false)
  const [collapsingGrid, setCollapsingGrid] = useState(false)
  const [pastedModalAttachment, setPastedModalAttachment] = useState<Attachment | null>(null)
  const [typewriterText, setTypewriterText] = useState('')
  const [selectedModel, setSelectedModel] = useState<string | null>(readSelectedModelFromStorage)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashPosition, setSlashPosition] = useState({ left: SLASH_POPUP_VIEWPORT_MARGIN, bottom: 0 })
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const draftScope = useMemo<InputDraftScope>(() => ({
    ownerKey: draftOwnerKey,
    page: variant === 'welcome' ? 'welcome' : 'thread',
    threadId: variant === 'welcome' ? undefined : workThreadId,
    appMode: appMode === 'work' ? 'work' : 'chat',
    searchMode,
  }), [appMode, draftOwnerKey, searchMode, variant, workThreadId])
  const draftScopeKey = useMemo(() => JSON.stringify(draftScope), [draftScope])
  const skipDraftPersistRef = useRef(false)
  const prevDraftScopeRef = useRef<InputDraftScope | null>(null)

  const [reasoningMode, setReasoningMode] = useState(() => {
    if (!workThreadId) return readSelectedReasoningMode()
    return readThreadReasoningMode(workThreadId)
  })

  useEffect(() => {
    if (!workThreadId) {
      setReasoningMode(readSelectedReasoningMode())
      return
    }
    setReasoningMode(readThreadReasoningMode(workThreadId))
  }, [workThreadId])

  const { isRecording, isTranscribing, recordingSeconds, waveformBars, startRecording, stopAndTranscribe, cancelRecording } =
    useAudioRecorder({ accessTokenRef, valueRef, onChangeRef, onAsrErrorRef, onVoiceNotConfiguredRef })

  const focusComposer = useCallback(() => composerEditorRef.current?.focus(), [])
  const { isFileDragging } = useAttachments({ onAttachFiles, focusInput: focusComposer })

  const persistSelectedPersona = useCallback((personaKey: string) => {
    setSelectedPersonaKey(personaKey)
    writeSelectedPersonaKeyToStorage(personaKey)
    onPersonaChange?.(personaKey)
  }, [onPersonaChange])

  const handleModelChange = useCallback((model: string | null) => {
    setSelectedModel(model)
    writeSelectedModelToStorage(model)
    setReasoningMode('off')
    if (workThreadId) {
      writeThreadReasoningMode(workThreadId, 'off')
      return
    }
    writeSelectedReasoningMode('off')
  }, [workThreadId])

  useEffect(() => {
    const syncSelectedModel = () => {
      setSelectedModel(readSelectedModelFromStorage())
    }
    window.addEventListener(SELECTED_MODEL_CHANGED_EVENT, syncSelectedModel)
    return () => window.removeEventListener(SELECTED_MODEL_CHANGED_EVENT, syncSelectedModel)
  }, [])

  const handleReasoningModeChange = useCallback((mode: string) => {
    setReasoningMode(mode)
    if (workThreadId) {
      writeThreadReasoningMode(workThreadId, mode)
      return
    }
    writeSelectedReasoningMode(mode)
  }, [workThreadId])

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setChildMenuOpen(open)
    if (open) composerEditorRef.current?.blur()
  }, [])

  const showSendButton = draft.trim().length > 0 || attachments.length > 0 || resourceReferences.length > 0
  const resolvedPlaceholder = typewriterText
  const isWelcomeInput = variant === 'welcome'
  const isWorkChat = variant === 'chat' && appMode === 'work'
  const hasAttachments = attachments.length > 0
  const showAttachmentGrid = hasAttachments && !collapsingGrid
  const showWelcomeAttachmentSpacer = isWelcomeInput && (!hasAttachments || collapsingGrid)
  const isPlainChatThread = variant === 'chat' && appMode !== 'work'
  const isEditingQueuedPrompt = !!queuedEditLabel

  const [composerSingleLine, setComposerSingleLine] = useState(true)
  const isWorkCompactInput = isWorkChat && composerSingleLine
  const isWorkExpandedInput = isWorkChat && !composerSingleLine
  const handleComposerLayoutChange = useCallback((state: { isSingleLine: boolean }) => {
    setComposerSingleLine(state.isSingleLine)
  }, [])

  const formPadding = isPlainChatThread
    ? '19px 12px 11px 20px'
    : isWelcomeInput
      ? '10px 14px 14px 22px'
      : isWorkChat
        ? '8px 12px 8px 14px'
        : '6px 12px 11px 20px'
  const canUseSlashCommands = appMode === 'work' && !!onTogglePlanMode

  const slashCommandGroups = useMemo<SlashCommandGroup[]>(() => {
    if (!canUseSlashCommands) return []
    return [
      {
        label: t.slashCommands.commandsLabel,
        items: [
          {
            id: 'setup',
            label: 'setup',
            description: t.slashCommands.setupDesc,
          },
          ...(referenceResource
            ? [{
                id: 'file',
                label: 'file',
                description: '引用当前文件',
              }]
            : []),
        ],
      },
      {
        label: t.slashCommands.modesLabel,
        items: [{
          id: 'plan',
          label: t.planMode,
          description: t.slashCommands.planDesc,
        }],
      },
    ]
  }, [
    canUseSlashCommands,
    referenceResource,
    t.planMode,
    t.slashCommands.commandsLabel,
    t.slashCommands.modesLabel,
    t.slashCommands.planDesc,
    t.slashCommands.setupDesc,
  ])

  const slashVisibleGroups = useMemo<SlashCommandGroup[]>(() => {
    const query = slashQuery.trim().toLowerCase()
    return slashCommandGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!query) return true
          return item.id.toLowerCase().startsWith(query) || item.label.toLowerCase().startsWith(query)
        }),
      }))
      .filter((group) => group.items.length > 0)
  }, [slashCommandGroups, slashQuery])

  const slashVisibleItems = useMemo(
    () => slashVisibleGroups.flatMap((group) => group.items),
    [slashVisibleGroups],
  )

  const handleComposerSlashChange = useCallback((state: ComposerSlashState) => {
    if (disabled || slashCommandGroups.length === 0) {
      setSlashOpen(false)
      return
    }
    if (!state.open) {
      setSlashOpen(false)
      return
    }
    const normalizedQuery = state.query.trim().toLowerCase()
    const exactCommand = normalizedQuery.length > 0 && slashCommandGroups.some((group) => (
      group.items.some((item) => (
        item.id !== 'file' && (item.id.toLowerCase() === normalizedQuery || item.label.toLowerCase() === normalizedQuery)
      ))
    ))
    if (exactCommand) {
      setSlashOpen(false)
      return
    }
    const visibleCount = slashCommandGroups.reduce((count, group) => (
      count + group.items.filter((item) => {
        if (!normalizedQuery) return true
        return item.id.toLowerCase().startsWith(normalizedQuery) || item.label.toLowerCase().startsWith(normalizedQuery)
      }).length
    ), 0)
    if (visibleCount === 0) {
      setSlashOpen(false)
      return
    }
    const maxLeft = window.innerWidth - SLASH_POPUP_WIDTH - SLASH_POPUP_VIEWPORT_MARGIN
    setSlashPosition({
      left: Math.max(SLASH_POPUP_VIEWPORT_MARGIN, Math.min(state.position.left, maxLeft)),
      bottom: state.position.bottom,
    })
    setSlashQuery(state.query)
    setSlashSelectedIndex((index) => Math.min(index, visibleCount - 1))
    setSlashOpen(true)
  }, [disabled, slashCommandGroups])

  const selectSlashItem = useCallback((item: SlashCommandItem) => {
    resetHistoryCursor()
    setSlashOpen(false)
    setSlashSelectedIndex(0)
    if (item.id === 'plan' && !planMode) void onTogglePlanMode?.(planMode)
    if (item.id === 'setup') composerEditorRef.current?.replaceSlashWithSetupCommand()
    if (item.id === 'file' && referenceResource) {
      composerEditorRef.current?.replaceSlashWithResource(referenceResource)
    }
    requestAnimationFrame(() => composerEditorRef.current?.focus())
  }, [onTogglePlanMode, planMode, referenceResource, resetHistoryCursor])

  useEffect(() => {
    const prevScope = prevDraftScopeRef.current
    const nextStored = readInputDraftText(draftScope)
    let nextDraft = nextStored
    if (
      isSameDraftDomain(prevScope, draftScope)
      && prevScope?.ownerKey !== draftScope.ownerKey
      && !nextStored
      && valueRef.current.trim()
    ) {
      nextDraft = valueRef.current
      writeInputDraftText(draftScope, nextDraft)
    }
    prevDraftScopeRef.current = draftScope
    historyRef.current = readInputHistory(draftScope)
    resetHistoryCursor()
    skipDraftPersistRef.current = true
    setDraft(nextDraft)
    composerEditorRef.current?.setValue(nextDraft)
  }, [draftScope, draftScopeKey, resetHistoryCursor])

  useEffect(() => {
    if (skipDraftPersistRef.current) {
      skipDraftPersistRef.current = false
      return
    }
    const serialized = composerEditorRef.current?.getValue() ?? draft
    writeInputDraftText(draftScope, serialized)
  }, [draft, resourceReferences, draftScope, draftScopeKey])

  useEffect(() => {
    if (!slashOpen) return
    if (slashVisibleItems.length === 0) {
      setSlashOpen(false)
      return
    }
    setSlashSelectedIndex((index) => Math.min(index, slashVisibleItems.length - 1))
  }, [slashOpen, slashVisibleItems.length])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (searchMode && selectedPersonaKey !== SEARCH_PERSONA_KEY) {
        persistSelectedPersona(SEARCH_PERSONA_KEY)
      } else if (!searchMode && selectedPersonaKey === SEARCH_PERSONA_KEY) {
        persistSelectedPersona(DEFAULT_PERSONA_KEY)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [persistSelectedPersona, searchMode, selectedPersonaKey])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (appMode === 'work' && selectedPersonaKey !== WORK_PERSONA_KEY) {
        persistSelectedPersona(WORK_PERSONA_KEY)
      } else if (appMode !== 'work' && selectedPersonaKey === WORK_PERSONA_KEY) {
        persistSelectedPersona(DEFAULT_PERSONA_KEY)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [persistSelectedPersona, appMode, selectedPersonaKey])

  const typewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const target = placeholder
    if (!target) {
      setTypewriterText('')
      return
    }
    let i = 0
    setTypewriterText('')
    const tick = () => {
      i++
      if (i > target.length) return
      setTypewriterText(target.slice(0, i))
      typewriterTimerRef.current = setTimeout(tick, 45)
    }
    typewriterTimerRef.current = setTimeout(tick, 45)
    return () => {
      if (typewriterTimerRef.current !== null) {
        clearTimeout(typewriterTimerRef.current)
        typewriterTimerRef.current = null
      }
    }
  }, [placeholder])

  const applyHistoryValue = useCallback((value: string) => {
    skipDraftPersistRef.current = true
    setDraft(value)
    composerEditorRef.current?.setValue(value)
    requestAnimationFrame(() => composerEditorRef.current?.focus())
  }, [])

  const handleHistoryNavigate = useCallback((direction: 'up' | 'down'): boolean => {
    const history = historyRef.current
    if (history.length === 0) return false
    const currentText = composerEditorRef.current?.getValue() ?? valueRef.current

    if (direction === 'up') {
      if (historyCursorRef.current < 0) historyDraftRef.current = currentText
      const nextCursor = historyCursorRef.current < 0
        ? 0
        : Math.min(historyCursorRef.current + 1, history.length - 1)
      if (nextCursor === historyCursorRef.current) return false
      historyCursorRef.current = nextCursor
      applyHistoryValue(history[history.length - 1 - nextCursor] ?? '')
      return true
    }

    if (historyCursorRef.current < 0) return false
    if (historyCursorRef.current === 0) {
      historyCursorRef.current = -1
      applyHistoryValue(historyDraftRef.current)
      historyDraftRef.current = ''
      return true
    }
    historyCursorRef.current -= 1
    applyHistoryValue(history[history.length - 1 - historyCursorRef.current] ?? '')
    return true
  }, [applyHistoryValue])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) onAttachFiles?.(files)
    e.target.value = ''
  }

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    const text = (composerEditorRef.current?.getValue() ?? '').trim()
    if (text) {
      appendInputHistory(draftScope, text)
      historyRef.current = readInputHistory(draftScope)
      resetHistoryCursor()
    }
    onSubmit(e, selectedPersonaKey, selectedModel ?? undefined)
  }

  return (
    <div
      className="w-full"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: variant === 'welcome' ? '840px' : isWorkChat ? undefined : '720px',
      }}
    >
      {isFileDragging && (
        <div
          className="flex items-center justify-center rounded-xl px-4 py-2 text-sm"
          style={{
            border: '0.5px dashed var(--c-border-subtle)',
            background: 'var(--c-bg-sub)',
            color: 'var(--c-text-secondary)',
          }}
        >
          {t.dragToAttach}
        </div>
      )}

      {(isRecording || isTranscribing) && (
        <div
          style={{
            border: 'var(--c-input-border)',
            borderRadius: '20px',
            padding: '10px 20px',
            background: 'var(--c-bg-input)',
            boxShadow: 'var(--c-input-shadow)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              height: '40px',
              overflow: 'hidden',
              WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,0.15) 0%, rgba(0,0,0,1) 60%)',
              maskImage: 'linear-gradient(to right, rgba(0,0,0,0.15) 0%, rgba(0,0,0,1) 60%)',
            }}
          >
            {waveformBars.map((h, i) => (
              <div
                key={i}
                style={{
                  width: '2px',
                  height: `${Math.max(3, Math.round(h * 38))}px`,
                  borderRadius: '999px',
                  background: 'var(--c-text-secondary)',
                  flexShrink: 0,
                  transition: 'height 0.06s ease',
                }}
              />
            ))}
          </div>

          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              fontSize: '14px',
              color: 'var(--c-text-secondary)',
              flexShrink: 0,
              minWidth: '36px',
              textAlign: 'right',
            }}
          >
            {formatRecordingTime(recordingSeconds)}
          </span>

          <button
            type="button"
            onClick={cancelRecording}
            disabled={isTranscribing}
            className="flex h-[33.5px] w-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] transition-[opacity,background] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:opacity-100 opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={14} />
          </button>

          <button
            type="button"
            onClick={stopAndTranscribe}
            disabled={isTranscribing}
            className="flex h-[33.5px] w-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-accent-send)] text-[var(--c-accent-send-text)] transition-[background-color,opacity] duration-[60ms] hover:bg-[var(--c-accent-send-hover)] active:opacity-[0.75] active:scale-[0.93] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTranscribing
              ? <Loader2 size={14} className="animate-spin" />
              : <Check size={14} />}
          </button>
        </div>
      )}

      <div
        className={[
          'bg-[var(--c-bg-input)] chat-input-box',
          (focused || childMenuOpen) && 'is-focused',
        ].filter(Boolean).join(' ')}
        style={{
          borderWidth: '0.5px',
          borderStyle: 'solid',
          borderColor: (focused || childMenuOpen)
            ? 'var(--c-input-border-color-focus)'
            : 'var(--c-input-border-color)',
          borderRadius: isWorkChat ? (isWorkCompactInput ? '12px' : '16px') : '20px',
          boxShadow: (focused || childMenuOpen)
            ? 'var(--c-input-shadow-focus)'
            : 'var(--c-input-shadow)',
          transition: isWorkChat
            ? 'border-color 0.2s ease, box-shadow 0.2s ease, border-radius 180ms cubic-bezier(0.16, 1, 0.3, 1)'
            : 'border-color 0.2s ease, box-shadow 0.2s ease',
          cursor: 'default',
          position: 'relative',
        }}
        onClick={(e) => {
          const tag = (e.target as HTMLElement).tagName
          if (tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SVG' && tag !== 'PATH') {
            composerEditorRef.current?.focus()
          }
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateRows: showAttachmentGrid ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.3s ease',
            overflow: 'hidden',
          }}
        >
          <div style={{ minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '14px 16px 8px' }}>
              {attachments.map((att) => {
                const removeHandler = () => {
                  if (attachments.length === 1) {
                    setCollapsingGrid(true)
                    setTimeout(() => {
                      onRemoveAttachment?.(att.id)
                      setCollapsingGrid(false)
                    }, 350)
                  } else {
                    onRemoveAttachment?.(att.id)
                  }
                }
                if (att.pasted) {
                  return (
                    <PastedContentCard
                      key={att.id}
                      attachment={att}
                      onRemove={removeHandler}
                      onClick={() => setPastedModalAttachment(att)}
                    />
                  )
                }
                return (
                  <AttachmentCard
                    key={att.id}
                    attachment={att}
                    onRemove={removeHandler}
                    accessToken={accessToken}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {isWelcomeInput && (
          <div
            style={{
              display: 'grid',
              gridTemplateRows: showWelcomeAttachmentSpacer ? '1fr' : '0fr',
              transition: 'grid-template-rows 0.3s ease',
              overflow: 'hidden',
            }}
          >
            <div style={{ minHeight: 0, overflow: 'hidden' }}>
              <div style={{ height: '14px' }} />
            </div>
          </div>
        )}

        <form
          ref={formRef}
          onSubmit={handleFormSubmit}
          style={{ padding: formPadding }}
        >
          <div
            className="flex items-center"
            style={{
              gap: '2px',
              minHeight: isWorkChat ? '34.5px' : '32px',
              width: '100%',
              minWidth: 0,
              flexWrap: isWorkCompactInput ? 'nowrap' : 'wrap',
            }}
          >
            <PersonaModelBar
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              thinkingEnabled={reasoningMode}
              onThinkingChange={handleReasoningModeChange}
              onOpenSettings={onOpenSettings}
              onFileInputClick={() => fileInputRef.current?.click()}
              accessToken={accessToken}
              variant={variant}
              appMode={appMode}
              threadHasMessages={hasMessages}
              threadMessagesLoading={messagesLoading}
              workThreadId={workThreadId}
              hideWorkFolderPicker={isWorkCompactInput}
              hideModelPicker={isWorkCompactInput}
              onMenuOpenChange={handleMenuOpenChange}
              planMode={planMode}
              onTogglePlanMode={onTogglePlanMode}
              learningModeEnabled={learningModeEnabled}
              onToggleLearningMode={onToggleLearningMode}
            />

            {isEditingQueuedPrompt && (
              <div
                className="flex shrink-0 items-center gap-1"
                style={{
                  height: '33.5px',
                  padding: '0 4px 0 9px',
                  borderRadius: '8px',
                  background: 'color-mix(in srgb, var(--c-bg-sub) 82%, transparent)',
                  border: '0.5px solid var(--c-border-subtle)',
                }}
              >
                <Pencil size={14} style={{ color: 'var(--c-text-secondary)', flexShrink: 0 }} />
                <span style={{
                  fontSize: '14px',
                  color: 'var(--c-text-secondary)',
                  fontWeight: 375,
                  whiteSpace: 'nowrap',
                  margin: '0 2px',
                }}>
                  {queuedEditLabel}
                </span>
                <button
                  type="button"
                  onClick={onCancelQueuedEdit}
                  className="bg-transparent hover:bg-[rgba(0,0,0,0.05)]"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    borderRadius: '5px',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <X size={14} strokeWidth={2} style={{ color: 'var(--c-text-secondary)', opacity: 0.7 }} />
                </button>
              </div>
            )}

            <ComposerEditor
              ref={composerEditorRef}
              value={draft}
              placeholder={resolvedPlaceholder}
              disabled={disabled}
              variant={variant}
              compact={isWorkCompactInput}
              expanded={isWorkExpandedInput}
              onLayoutChange={handleComposerLayoutChange}
              onHistoryNavigate={handleHistoryNavigate}
              onPasteFile={(files) => onAttachFiles?.(files)}
              onPasteLongContent={(text) => onPasteContent?.(text)}
              onChange={({ text, references }) => {
                resetHistoryCursor()
                setDraft(text)
                setResourceReferences(references)
              }}
              onSlashChange={handleComposerSlashChange}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false)
                window.setTimeout(() => setSlashOpen(false), 150)
              }}
              onKeyDown={(e) => {
                if (!slashOpen) return
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  e.stopPropagation()
                  setSlashSelectedIndex((index) => (
                    slashVisibleItems.length === 0 ? 0 : (index - 1 + slashVisibleItems.length) % slashVisibleItems.length
                  ))
                  return
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  e.stopPropagation()
                  setSlashSelectedIndex((index) => (
                    slashVisibleItems.length === 0 ? 0 : (index + 1) % slashVisibleItems.length
                  ))
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  e.stopPropagation()
                  const item = slashVisibleItems[slashSelectedIndex]
                  if (item) selectSlashItem(item)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setSlashOpen(false)
                }
              }}
              onSubmit={() => {
                if (!disabled && (draft.trim() || attachments.length > 0 || resourceReferences.length > 0)) {
                  formRef.current?.requestSubmit()
                }
              }}
            />

            {isWorkCompactInput && (
              <div style={{ flexShrink: 0, marginRight: '4px', display: 'flex', alignItems: 'center', position: 'relative' }}>
                <ModelPicker
                  accessToken={accessToken}
                  value={selectedModel}
                  onChange={handleModelChange}
                  onAddModel={() => onOpenSettings?.('models')}
                  variant={variant}
                  thinkingEnabled={reasoningMode}
                  onThinkingChange={handleReasoningModeChange}
                  onOpenChange={handleMenuOpenChange}
                />
              </div>
            )}

            <div
              style={{
                position: 'relative',
                width: '31.5px',
                height: '31.5px',
                flexShrink: 0,
              }}
            >
              {disabled ? (
                <div className="flex h-full w-full items-center justify-center rounded-lg bg-[var(--c-accent-send)]" style={{ opacity: 0.5 }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--c-accent-send-text)' }} />
                </div>
              ) : isStreaming && canCancel && !isEditingQueuedPrompt ? (
                showSendButton ? (
                  <ActionIconButton
                    type="submit"
                    disabled={!draft.trim() && attachments.length === 0 && resourceReferences.length === 0}
                    tooltip={t.sendAction}
                    shortcut={SHORTCUTS.sendMessage.binding}
                    className="flex h-full w-full items-center justify-center rounded-lg bg-[var(--c-accent-send)] text-[var(--c-accent-send-text)] hover:bg-[var(--c-accent-send-hover)] active:opacity-[0.75] active:scale-[0.93] disabled:cursor-not-allowed"
                    wrapperStyle={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                    style={{ position: 'absolute', inset: 0 }}
                  >
                    <ArrowUp size={17} />
                  </ActionIconButton>
                ) : (
                  <ActionIconButton
                    type="button"
                    onClick={onCancel}
                    disabled={cancelSubmitting}
                    tooltip={t.stopAction}
                    className="flex h-full w-full items-center justify-center rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-input)] transition-[opacity,transform,background-color] duration-[140ms] hover:bg-[var(--c-bg-sub)] active:scale-[0.97] active:opacity-[0.82] disabled:cursor-not-allowed disabled:opacity-50"
                    wrapperStyle={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                    style={{ position: 'absolute', inset: 0 }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '999px',
                        border: '1.3px solid var(--c-text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '1px',
                          background: 'var(--c-text-primary)',
                          flexShrink: 0,
                        }}
                      />
                    </span>
                  </ActionIconButton>
                )
              ) : (
                <>
                  <ActionIconButton
                    type="button"
                    onClick={startRecording}
                    disabled={isRecording || isTranscribing || !accessToken}
                    tooltip={t.recordVoiceAction}
                    className="flex h-full w-full items-center justify-center rounded-lg text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-30"
                    wrapperStyle={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: showSendButton ? 'none' : 'auto',
                    }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: showSendButton ? 0 : 0.65,
                      transform: showSendButton ? 'scale(0.7)' : 'scale(1)',
                      transition: 'opacity 188ms ease, transform 188ms ease',
                      pointerEvents: showSendButton ? 'none' : 'auto',
                    }}
                  >
                    <Mic size={19} />
                  </ActionIconButton>
                  <ActionIconButton
                    type="submit"
                    disabled={(!isEditingQueuedPrompt && isStreaming) || (!draft.trim() && attachments.length === 0 && resourceReferences.length === 0)}
                    tooltip={t.sendAction}
                    shortcut={SHORTCUTS.sendMessage.binding}
                    className="flex h-full w-full items-center justify-center rounded-lg bg-[var(--c-accent-send)] text-[var(--c-accent-send-text)] hover:bg-[var(--c-accent-send-hover)] active:opacity-[0.75] active:scale-[0.93] disabled:cursor-not-allowed"
                    wrapperStyle={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: showSendButton ? 'auto' : 'none',
                    }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      transform: showSendButton ? 'scale(1)' : 'scale(0)',
                      opacity: showSendButton ? 1 : 0,
                      transition: 'transform 281ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease, background-color 60ms ease',
                      pointerEvents: showSendButton ? 'auto' : 'none',
                    }}
                  >
                    <ArrowUp size={17} />
                  </ActionIconButton>
                </>
              )}
            </div>
          </div>
        </form>

        {slashOpen && slashVisibleGroups.length > 0 && (
          <SlashCommandPopup
            groups={slashVisibleGroups}
            selectedIndex={slashSelectedIndex}
            position={slashPosition}
            onSelect={selectSlashItem}
            onMouseEnter={setSlashSelectedIndex}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {disabled && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: isWorkChat ? (isWorkCompactInput ? '12px' : '16px') : '20px',
              background: 'rgba(0,0,0,0.06)',
              overflow: 'hidden',
              pointerEvents: 'none',
              animation: 'freeze-overlay-in 1.8s ease forwards',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: '35%',
                background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.05), transparent)',
                animation: 'input-sweep 1.4s linear infinite',
              }}
            />
          </div>
        )}
      </div>

      {pastedModalAttachment?.pasted && (
        <PastedContentModal
          text={pastedModalAttachment.pasted.text}
          size={pastedModalAttachment.size}
          lineCount={pastedModalAttachment.pasted.lineCount}
          onClose={() => setPastedModalAttachment(null)}
        />
      )}
    </div>
  )
})

