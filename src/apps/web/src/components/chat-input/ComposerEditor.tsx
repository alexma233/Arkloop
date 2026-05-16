import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  DecoratorNode,
  KEY_ENTER_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  PASTE_COMMAND,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical'
import { ResourceReferenceChip } from '../ResourceReferenceChip'
import type { ResourceRef } from '../resource-preview/types'
import { resourceTitle } from '../resource-preview/resourceUri'
import {
  serializeMessageWithResourceReferences,
  splitMessageResourceReferences,
} from '../../resourceReferences'
import { hasTransferFiles, extractFilesFromTransfer } from './AttachmentCard'

type SerializedResourceReferenceNode = SerializedLexicalNode & {
  resource: ResourceRef
}

export type ComposerEditorValue = {
  text: string
  references: ResourceRef[]
  serialized: string
}

export type ComposerSlashState = {
  open: boolean
  query: string
  position: { left: number; bottom: number }
}

export type ComposerEditorHandle = {
  clear: () => void
  setText: (text: string) => void
  setValue: (serialized: string) => void
  getValue: () => string
  focus: () => void
  blur: () => void
  getEditor: () => LexicalEditor | null
  replaceSlashWithText: (text: string) => void
  replaceSlashWithSetupCommand: () => void
  replaceSlashWithResource: (resource: ResourceRef) => void
}

type Props = {
  value: string
  placeholder: string
  disabled?: boolean
  compact?: boolean
  expanded?: boolean
  variant?: 'welcome' | 'chat'
  onHistoryNavigate?: (direction: 'up' | 'down') => boolean
  onPasteFile?: (files: File[]) => void
  onPasteLongContent?: (text: string) => void
  onChange: (value: ComposerEditorValue) => void
  onSlashChange: (state: ComposerSlashState) => void
  onFocus: () => void
  onBlur: () => void
  onSubmit: () => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onLayoutChange?: (state: { isSingleLine: boolean }) => void
}

const PASTE_LINE_THRESHOLD = 20

const SETUP_COMMAND_HEAD_COLOR = 'rgb(159, 186, 231)'
const SETUP_COMMAND_TEXT_COLOR = 'rgb(64, 117, 208)'
const SETUP_COMMAND_BG = 'rgb(231, 239, 251)'

class SetupCommandNode extends DecoratorNode<ReactNode> {
  static getType(): string {
    return 'setup-command'
  }

  static clone(node: SetupCommandNode): SetupCommandNode {
    return new SetupCommandNode(node.__key)
  }

  static importJSON(): SetupCommandNode {
    return new SetupCommandNode()
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.style.display = 'inline-flex'
    element.style.verticalAlign = 'middle'
    element.contentEditable = 'false'
    return element
  }

  updateDOM(): boolean {
    return false
  }

  decorate(): ReactNode {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: '24px',
          padding: '0 9px',
          borderRadius: '6.5px',
          background: SETUP_COMMAND_BG,
          fontSize: '16px',
          fontWeight: 310,
          lineHeight: '20px',
          verticalAlign: 'middle',
        }}
      >
        <span style={{ color: SETUP_COMMAND_HEAD_COLOR }}>/</span>
        <span style={{ color: SETUP_COMMAND_TEXT_COLOR }}>setup</span>
      </span>
    )
  }

  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  exportJSON(): SerializedLexicalNode {
    return {
      type: 'setup-command',
      version: 1,
    }
  }

  getTextContent(): string {
    return '/setup'
  }
}

function $createSetupCommandNode(): SetupCommandNode {
  return new SetupCommandNode()
}

class ResourceReferenceNode extends DecoratorNode<ReactNode> {
  __resource: ResourceRef

  static getType(): string {
    return 'resource-reference'
  }

  static clone(node: ResourceReferenceNode): ResourceReferenceNode {
    return new ResourceReferenceNode(node.__resource, node.__key)
  }

  static importJSON(serializedNode: SerializedLexicalNode): ResourceReferenceNode {
    return new ResourceReferenceNode((serializedNode as SerializedResourceReferenceNode).resource)
  }

  constructor(resource: ResourceRef, key?: NodeKey) {
    super(key)
    this.__resource = resource
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.style.display = 'inline-flex'
    element.style.verticalAlign = 'middle'
    element.contentEditable = 'false'
    return element
  }

  updateDOM(): boolean {
    return false
  }

  decorate(): ReactNode {
    return <ResourceReferenceChip resource={this.__resource} compact />
  }

  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  exportJSON(): SerializedResourceReferenceNode {
    return {
      type: 'resource-reference',
      version: 1,
      resource: this.__resource,
    }
  }

  getTextContent(): string {
    return resourceTitle(this.__resource)
  }

  getResource(): ResourceRef {
    return this.__resource
  }
}

function $createResourceReferenceNode(resource: ResourceRef): ResourceReferenceNode {
  return new ResourceReferenceNode(resource)
}

function $isResourceReferenceNode(node: LexicalNode | null | undefined): node is ResourceReferenceNode {
  return node instanceof ResourceReferenceNode
}

function $selectionNeedsLeadingSpace(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  const anchor = selection.anchor
  const node = anchor.getNode()
  if (!$isTextNode(node)) return false
  if (anchor.offset > 0) return !/\s$/.test(node.getTextContent().slice(0, anchor.offset))
  const previous = node.getPreviousSibling()
  return !!previous && !/\s$/.test(previous.getTextContent())
}

function $isCursorAtRootStart(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
  const anchor = selection.anchor
  const node = anchor.getNode()
  if (!$isTextNode(node)) return false
  if (anchor.offset > 0) return false
  const root = $getRoot()
  const firstChild = root.getFirstChild()
  if (firstChild !== node.getParent()) return false
  const paragraph = node.getParent()
  if (!paragraph) return false
  return paragraph === root.getFirstChild() && node === paragraph.getFirstChild()
}

function $isCursorAtRootEnd(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
  const anchor = selection.anchor
  const node = anchor.getNode()
  if (!$isTextNode(node)) return false
  const text = node.getTextContent()
  if (anchor.offset < text.length) return false
  const root = $getRoot()
  const lastChild = root.getLastChild()
  const paragraph = node.getParent()
  if (paragraph !== lastChild) return false
  if (node !== paragraph!.getLastChild()) return false
  const nextSibling = node.getNextSibling()
  if (nextSibling) return false
  const nextParagraph = paragraph!.getNextSibling()
  if (nextParagraph) return false
  return true
}

function collectResourceReferences(node: LexicalNode, references: ResourceRef[]) {
  if ($isResourceReferenceNode(node)) {
    references.push(node.getResource())
    return
  }
  const maybeParent = node as LexicalNode & { getChildren?: () => LexicalNode[] }
  const children = maybeParent.getChildren?.()
  if (!children) return
  for (const child of children) collectResourceReferences(child, references)
}

function readComposerText(node: LexicalNode): string {
  if ($isResourceReferenceNode(node)) return ''
  const maybeParent = node as LexicalNode & { getChildren?: () => LexicalNode[] }
  const children = maybeParent.getChildren?.()
  if (!children) return node.getTextContent()
  return children.map(readComposerText).join('')
}

function readEditorValue(editorState: EditorState): ComposerEditorValue {
  return editorState.read(() => {
    const root = $getRoot()
    const text = readComposerText(root)
    const references: ResourceRef[] = []
    collectResourceReferences(root, references)
    return {
      text,
      references,
      serialized: serializeMessageWithResourceReferences(text, references),
    }
  })
}

function getSelectionRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  if (rect.width || rect.height) return rect
  return range.getClientRects()[0] ?? null
}

function getSlashQuery(editorState: EditorState) {
  return editorState.read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
    const anchor = selection.anchor
    const node = anchor.getNode()
    if (!$isTextNode(node)) return null
    const beforeCursor = node.getTextContent().slice(0, anchor.offset)
    const start = beforeCursor.lastIndexOf('/')
    if (start < 0) return null
    const query = beforeCursor.slice(start + 1)
    if (/[\s\n]/.test(query)) return null
    return query
  })
}

function replaceCurrentSlash(editor: LexicalEditor, insert: () => void) {
  editor.update(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const anchor = selection.anchor
    const node = anchor.getNode()
    if ($isTextNode(node)) {
      const text = node.getTextContent()
      const start = text.slice(0, anchor.offset).lastIndexOf('/')
      if (start >= 0) {
        selection.setTextNodeRange(node, start, node, anchor.offset)
        selection.removeText()
      }
    }
    insert()
  })
}

const SETUP_COMMAND_TEXT_PATTERN = /\/setup(?=\s|$)/g

function appendTextWithSetupTokens(paragraph: ReturnType<typeof $createParagraphNode>, text: string) {
  if (!text) return
  let lastIndex = 0
  let match: RegExpExecArray | null
  SETUP_COMMAND_TEXT_PATTERN.lastIndex = 0
  while ((match = SETUP_COMMAND_TEXT_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      paragraph.append($createTextNode(text.slice(lastIndex, match.index)))
    }
    paragraph.append($createSetupCommandNode())
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    paragraph.append($createTextNode(text.slice(lastIndex)))
  }
  SETUP_COMMAND_TEXT_PATTERN.lastIndex = 0
}

function deserializeToEditorContent(text: string) {
  const parts = splitMessageResourceReferences(text)
  const paragraph = $createParagraphNode()
  let needsSeparator = false
  for (const part of parts) {
    if (needsSeparator && part.type === 'text') needsSeparator = false
    if (part.type === 'text') {
      if (part.text) appendTextWithSetupTokens(paragraph, part.text)
    } else if (part.type === 'reference' && part.resource) {
      if (paragraph.getLastChild()) paragraph.append($createTextNode(' '))
      paragraph.append($createResourceReferenceNode(part.resource))
      paragraph.append($createTextNode(' '))
      needsSeparator = true
    }
  }
  return paragraph
}

function EditorBridge({
  disabled,
  onHistoryNavigate,
  onPasteFile,
  onPasteLongContent,
  onChange,
  onSlashChange,
  onSubmit,
  exposeEditor,
}: {
  disabled: boolean
  onHistoryNavigate?: (direction: 'up' | 'down') => boolean
  onPasteFile?: (files: File[]) => void
  onPasteLongContent?: (text: string) => void
  onChange: (value: ComposerEditorValue) => void
  onSlashChange: (state: ComposerSlashState) => void
  onSubmit: () => void
  exposeEditor: (editor: LexicalEditor | null) => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    exposeEditor(editor)
    return () => exposeEditor(null)
  }, [editor, exposeEditor])

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (event?.shiftKey) return false
      event?.preventDefault()
      onSubmit()
      return true
    },
    COMMAND_PRIORITY_EDITOR,
  ), [editor, onSubmit])

  useEffect(() => {
    if (!onHistoryNavigate) return
    return editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        const state = editor.getEditorState()
        const atStart = state.read(() => $isCursorAtRootStart())
        if (atStart) return onHistoryNavigate('up')
        return false
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor, onHistoryNavigate])

  useEffect(() => {
    if (!onHistoryNavigate) return
    return editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        const state = editor.getEditorState()
        const atEnd = state.read(() => $isCursorAtRootEnd())
        if (atEnd) return onHistoryNavigate('down')
        return false
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor, onHistoryNavigate])

  useEffect(() => {
    if (!onPasteFile && !onPasteLongContent) return
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent | null) => {
        if (!event) return false
        const clipboard = event.clipboardData

        if (onPasteFile && hasTransferFiles(clipboard)) {
          const files = extractFilesFromTransfer(clipboard)
          if (files.length > 0) {
            event.preventDefault()
            onPasteFile(files)
            return true
          }
        }

        const text = clipboard?.getData('text/plain') ?? ''
        if (!text) return false

        const lineCount = text.split(/\r?\n/).length
        if (onPasteLongContent && lineCount >= PASTE_LINE_THRESHOLD) {
          event.preventDefault()
          onPasteLongContent(text)
          return true
        }

        if (/\n{2,}/.test(text)) {
          event.preventDefault()
          const cleaned = text.replace(/\n{2,}/g, '\n')
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) selection.insertText(cleaned)
          })
          return true
        }

        return false
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor, onPasteFile, onPasteLongContent])

  const handleChange = useCallback((editorState: EditorState) => {
    onChange(readEditorValue(editorState))
    const query = getSlashQuery(editorState)
    const rect = query === null ? null : getSelectionRect()
    if (query === null || !rect) {
      onSlashChange({ open: false, query: '', position: { left: 0, bottom: 0 } })
      return
    }
    onSlashChange({
      open: true,
      query,
      position: { left: rect.right, bottom: rect.top },
    })
  }, [onChange, onSlashChange])

  return <OnChangePlugin ignoreHistoryMergeTagChange onChange={handleChange} />
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, Props>(function ComposerEditor({
  value,
  placeholder,
  disabled = false,
  compact = false,
  expanded = false,
  onHistoryNavigate,
  onPasteFile,
  onPasteLongContent,
  onChange,
  onSlashChange,
  onFocus,
  onBlur,
  onSubmit,
  onKeyDown,
  onLayoutChange,
}, ref) {
  const editorRef = useRef<LexicalEditor | null>(null)
  const valueRef = useRef(value)
  const didMountRef = useRef(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange

  const initialConfig = useMemo(() => ({
    namespace: 'arkloop-composer-editor',
    nodes: [ResourceReferenceNode, SetupCommandNode],
    onError(error: Error) {
      throw error
    },
  }), [])

  const exposeEditor = useCallback((editor: LexicalEditor | null) => {
    editorRef.current = editor
  }, [])

  const clear = useCallback(() => {
    editorRef.current?.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.select()
    })
  }, [])

  const setText = useCallback((text: string) => {
    editorRef.current?.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      if (text) paragraph.append($createTextNode(text))
      root.append(paragraph)
      paragraph.selectEnd()
    })
  }, [])

  const setValue = useCallback((serialized: string) => {
    editorRef.current?.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = deserializeToEditorContent(serialized)
      root.append(paragraph)
      paragraph.selectEnd()
    })
  }, [])

  useImperativeHandle(ref, () => ({
    clear,
    setText,
    setValue,
    getValue: () => (
      editorRef.current
        ? readEditorValue(editorRef.current.getEditorState()).serialized
        : serializeMessageWithResourceReferences(valueRef.current, [])
    ),
    focus: () => editorRef.current?.focus(),
    blur: () => editorRef.current?.blur(),
    getEditor: () => editorRef.current,
    replaceSlashWithText: (text: string) => {
      const editor = editorRef.current
      if (!editor) return
      replaceCurrentSlash(editor, () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText(text)
      })
    },
    replaceSlashWithSetupCommand: () => {
      const editor = editorRef.current
      if (!editor) return
      replaceCurrentSlash(editor, () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const nodes: LexicalNode[] = []
        if ($selectionNeedsLeadingSpace()) nodes.push($createTextNode(' '))
        nodes.push($createSetupCommandNode(), $createTextNode(' '))
        selection.insertNodes(nodes)
      })
    },
    replaceSlashWithResource: (resource: ResourceRef) => {
      const editor = editorRef.current
      if (!editor) return
      replaceCurrentSlash(editor, () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const nodes: LexicalNode[] = []
        if ($selectionNeedsLeadingSpace()) nodes.push($createTextNode(' '))
        nodes.push($createResourceReferenceNode(resource), $createTextNode(' '))
        selection.insertNodes(nodes)
      })
    },
  }), [clear, setText, setValue])

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!didMountRef.current) {
      didMountRef.current = true
      if (value) setValue(value)
      return
    }
    if (value === readEditorValue(editor.getEditorState()).text) return
  }, [setValue, value])

  useEffect(() => {
    const wrapper = contentRef.current
    if (!wrapper) return
    const editable = wrapper.querySelector<HTMLElement>('.arkloop-composer-editor')
    if (!editable) return

    let compactWidth: number | null = null

    const probeAtCompactWidth = (): boolean => {
      if (compactWidth === null) return false
      const style = window.getComputedStyle(editable)
      const probe = document.createElement('div')
      probe.style.position = 'fixed'
      probe.style.left = '-99999px'
      probe.style.top = '0'
      probe.style.width = compactWidth + 'px'
      probe.style.visibility = 'hidden'
      probe.style.pointerEvents = 'none'
      probe.style.fontFamily = style.fontFamily
      probe.style.fontSize = style.fontSize
      probe.style.fontWeight = style.fontWeight
      probe.style.lineHeight = style.lineHeight
      probe.style.letterSpacing = style.letterSpacing
      probe.style.whiteSpace = 'pre-wrap'
      probe.style.overflowWrap = 'break-word'
      probe.style.boxSizing = 'content-box'
      probe.textContent = editable.textContent || ''
      document.body.appendChild(probe)
      const probeWraps = probe.scrollHeight > 26
      document.body.removeChild(probe)
      return probeWraps
    }

    const measure = () => {
      const lineHeight = 24
      const wrapsNow = editable.scrollHeight > lineHeight + 2
      if (wrapsNow) {
        onLayoutChangeRef.current?.({ isSingleLine: false })
        return
      }
      const currentWidth = editable.clientWidth
      if (compactWidth === null || currentWidth <= compactWidth + 1) {
        compactWidth = currentWidth
        onLayoutChangeRef.current?.({ isSingleLine: true })
        return
      }
      const wrapsAtCompact = probeAtCompactWidth()
      onLayoutChangeRef.current?.({ isSingleLine: !wrapsAtCompact })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(editable)
    return () => observer.disconnect()
  }, [])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        ref={contentRef}
        style={{
          position: 'relative',
          minWidth: 0,
          flex: compact ? '1 1 auto' : '0 0 100%',
          width: compact ? undefined : '100%',
          order: compact ? undefined : -1,
          marginBottom: compact ? undefined : (expanded ? '6px' : '9px'),
          marginLeft: compact ? undefined : (expanded ? '3.5px' : undefined),
          padding: compact ? '0 8px 0 4px' : (expanded ? '10px 0 0' : undefined),
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              className="arkloop-composer-editor"
              aria-placeholder={placeholder}
              placeholder={(
                <span
                  style={{
                    position: 'absolute',
                    left: compact ? '4px' : 0,
                    top: compact ? '50%' : (expanded ? '10px' : 0),
                    transform: compact ? 'translateY(-50%)' : undefined,
                    color: 'var(--c-placeholder)',
                    fontSize: '16px',
                    fontWeight: 360,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  {placeholder}
                </span>
              )}
              onFocus={() => {
                onFocus()
              }}
              onKeyDown={onKeyDown}
              onBlur={() => {
                window.setTimeout(() => onSlashChange({ open: false, query: '', position: { left: 0, bottom: 0 } }), 150)
                onBlur()
              }}
              spellCheck={false}
              style={{
                width: '100%',
                minWidth: 0,
                maxHeight: '300px',
                overflowY: 'auto',
                outline: 'none',
                fontFamily: 'inherit',
                fontSize: '16px',
                fontWeight: 310,
                lineHeight: '24px',
                color: 'var(--c-text-primary)',
                caretColor: 'var(--c-text-primary)',
                letterSpacing: '-0.16px',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
                opacity: disabled ? 0.55 : 1,
              }}
            />
          )}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorBridge
          disabled={disabled}
          onHistoryNavigate={onHistoryNavigate}
          onPasteFile={onPasteFile}
          onPasteLongContent={onPasteLongContent}
          onChange={onChange}
          onSlashChange={onSlashChange}
          onSubmit={onSubmit}
          exposeEditor={exposeEditor}
        />
      </div>
    </LexicalComposer>
  )
})
