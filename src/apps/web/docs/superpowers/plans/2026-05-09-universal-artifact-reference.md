# 统一 Artifact 引用协议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Artifact Resource 消息协议，使 Chat 消息中的 artifact 可与文本混合展示。

**Architecture:** 取消持久化数据库层，Artifact Resource 元数据全部随消息传递。文件类走现有 `sandbox-artifacts` + key 引用，非文件类走消息内联。前端通过预解析器拆分 content 中的 `<artifact>` 标记，文本段走 Markdown 渲染，产物段走 `InlineArtifactCard`。

**Tech Stack:** Go 1.26 (后端) / React 19 + TypeScript 5.9 (前端)

---

## 文件结构

### 后端 (Go)
| 文件 | 职责 |
|------|------|
| `src/services/shared/artifact/artifact.go` | ArtifactResource / ArtifactHandle Go 类型定义 |
| `src/services/api/internal/http/conversationapi/message_content.go` | 消息响应中增加 `artifacts` 字段（修改） |
| `src/services/api/internal/data/messages_repo.go` | `Message.MetadataJSON` 中存储 artifacts（修改） |

### 前端 (TypeScript/React)
| 文件 | 职责 |
|------|------|
| `src/apps/shared/src/artifact.ts` | ArtifactResource、ArtifactHandle、ContentSegment 类型定义 |
| `src/apps/web/src/lib/parseMixedContent.ts` | Content 预解析器（拆分段落） |
| `src/apps/web/src/lib/parseMixedContent.test.ts` | 解析器单元测试 |
| `src/apps/web/src/components/InlineArtifactCard.tsx` | 内联产物卡片组件 |
| `src/apps/web/src/components/InlineArtifactCard.test.tsx` | 卡片组件单元测试 |
| `src/apps/web/src/components/MixedContentRenderer.tsx` | 混合内容渲染器（文本+产物） |
| `src/apps/web/src/components/MixedContentRenderer.test.tsx` | 混合渲染器单元测试 |
| `src/apps/web/src/components/messagebubble/AssistantMessage.tsx` | 集成内联渲染（修改） |

---

## Task 1: 后端 ArtifactResource 类型定义

**Files:**
- Create: `src/services/shared/artifact/artifact.go`

- [ ] **Step 1: 写类型定义**

```go
package artifact

// Handle 轻量引用
type Handle struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

// Producer 来源信息
type Producer struct {
	Type     string  `json:"type"`
	ID       string  `json:"id"`
	RunID    *string `json:"runId,omitempty"`
	PluginID *string `json:"pluginId,omitempty"`
}

// Resource 完整资源描述，随消息传递
type Resource struct {
	ID           string         `json:"id"`
	Kind         string         `json:"kind"`
	Version      *string        `json:"version,omitempty"`
	Title        string         `json:"title"`
	Summary      *string        `json:"summary,omitempty"`
	Labels       []string       `json:"labels,omitempty"`
	MimeType     *string        `json:"mimeType,omitempty"`
	Producer     Producer       `json:"producer"`
	FetchMode    string         `json:"fetchMode"`
	Descriptor   map[string]any `json:"descriptor"`
	Capabilities []string       `json:"capabilities,omitempty"`
}

// KindConfig 系统级 kind 渲染配置（非消息字段，启动时注册）
type KindConfig struct {
	Previewable    bool    `json:"previewable"`
	CardType       string  `json:"cardType"`
	DefaultDisplay string  `json:"defaultDisplay"`
	DefaultViewer  *string `json:"defaultViewer,omitempty"`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/shared/artifact/artifact.go
git commit -m "feat(shared): add ArtifactResource Go types"
```

---

## Task 2: 后端消息响应增加 artifacts 字段

**Files:**
- Modify: `src/services/api/internal/http/conversationapi/message_content.go`
- Modify: `src/services/api/internal/http/conversationapi/v1_messages.go`

- [ ] **Step 1: 修改 messageResponse 结构**

在 `message_content.go` 中，给 `messageResponse` 增加 `Artifacts` 字段：

```go
type messageResponse struct {
	ID              string          `json:"id"`
	AccountID       string          `json:"account_id"`
	ThreadID        string          `json:"thread_id"`
	CreatedByUserID *string         `json:"created_by_user_id"`
	RunID           *string         `json:"run_id,omitempty"`
	Role            string          `json:"role"`
	Content         string          `json:"content"`
	ContentJSON     json.RawMessage `json:"content_json,omitempty"`
	Artifacts       json.RawMessage `json:"artifacts,omitempty"`  // NEW
	CreatedAt       string          `json:"created_at"`
}
```

- [ ] **Step 2: 修改消息序列化逻辑**

在 `v1_messages.go` 中，找到将 `data.Message` 转换为 `messageResponse` 的位置。从 `Message.MetadataJSON` 中解析 `artifacts` 字段：

```go
// 在消息转响应的函数中
var artifactsRaw json.RawMessage
if len(msg.MetadataJSON) > 0 {
	var metadata map[string]any
	if err := json.Unmarshal(msg.MetadataJSON, &metadata); err == nil {
		if artifacts, ok := metadata["artifacts"]; ok {
			artifactsRaw, _ = json.Marshal(artifacts)
		}
	}
}

resp := messageResponse{
	// ... 其他字段
	Artifacts: artifactsRaw,
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/api/internal/http/conversationapi/message_content.go src/services/api/internal/http/conversationapi/v1_messages.go
git commit -m "feat(api): add artifacts field to message response"
```

---

## Task 3: 前端 shared 类型定义

**Files:**
- Create: `src/apps/shared/src/artifact.ts`
- Modify: `src/apps/shared/src/index.ts`

- [ ] **Step 1: 写类型定义**

```ts
// src/apps/shared/src/artifact.ts

/**
 * 轻量 Artifact 引用
 */
export interface ArtifactHandle {
  id: string;
  kind: string;
}

/**
 * Artifact 来源信息
 */
export interface ArtifactProducer {
  type: 'agent' | 'plugin' | 'input-library' | 'import';
  id: string;
  runId?: string;
  pluginId?: string;
}

/**
 * 完整 Artifact 资源描述
 */
export interface ArtifactResource {
  id: string;
  kind: string;
  version?: string;
  title: string;
  summary?: string;
  labels?: string[];
  mimeType?: string;
  producer: ArtifactProducer;
  fetchMode: 'object-blob' | 'api-resource' | 'external-url' | 'plugin-resolver' | 'inline-json';
  descriptor: Record<string, unknown>;
  capabilities?: string[];
}

/**
 * 系统级 Kind 渲染配置
 */
export interface KindConfig {
  previewable: boolean;
  cardType: string;
  defaultDisplay: string;
  defaultViewer?: string;
}

/**
 * 插件 Viewer 注册信息
 */
export interface ArtifactViewerRegistration {
  pluginId: string;
  supports: string[];
  openMode: 'route' | 'embedded-browser' | 'hybrid' | 'panel';
  priority: number;
}

/**
 * 插件打开时的上下文
 */
export interface ArtifactContext {
  artifact: ArtifactResource;
  invocation: {
    sourceSurface: 'chat' | 'input-library' | 'workspace';
    trigger: 'click' | 'command' | 'agent';
    preferredMode?: 'route' | 'embedded-browser' | 'hybrid';
  };
  relatedArtifacts?: ArtifactResource[];
  sessionContext?: unknown;
}

/**
 * 内联 artifact 标记解析后的段落
 */
export type ContentSegment =
  | { type: 'text'; text: string }
  | { type: 'artifact'; id: string; kind: string; title?: string };
```

- [ ] **Step 2: 导出类型（修改 index.ts）**

在 `src/apps/shared/src/index.ts` 中添加：

```ts
export type {
  ArtifactHandle,
  ArtifactResource,
  ArtifactProducer,
  KindConfig,
  ArtifactViewerRegistration,
  ArtifactContext,
  ContentSegment,
} from './artifact'
```

- [ ] **Step 3: 验证类型检查**

```bash
cd /Users/huhui/Projects/Arkloop/src/apps/shared && pnpm type-check
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/apps/shared/src/artifact.ts src/apps/shared/src/index.ts
git commit -m "feat(shared): add Artifact Resource type definitions"
```

---

## Task 4: 前端内容预解析器

**Files:**
- Create: `src/apps/web/src/lib/parseMixedContent.ts`
- Create: `src/apps/web/src/lib/parseMixedContent.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/apps/web/src/lib/parseMixedContent.test.ts
import { describe, it, expect } from 'vitest'
import { parseMixedContent } from './parseMixedContent'

describe('parseMixedContent', () => {
  it('parses content with inline artifact markers', () => {
    const content = 'Hello\n\n<artifact id="art_001" kind="design.canvas" title="Design" />\n\nWorld'
    const result = parseMixedContent(content)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: 'text', text: 'Hello\n\n' })
    expect(result[1]).toEqual({ type: 'artifact', id: 'art_001', kind: 'design.canvas', title: 'Design' })
    expect(result[2]).toEqual({ type: 'text', text: '\n\nWorld' })
  })

  it('returns single text segment when no markers', () => {
    const content = 'Just plain text'
    const result = parseMixedContent(content)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ type: 'text', text: 'Just plain text' })
  })

  it('handles empty title attribute', () => {
    const content = '<artifact id="art_002" kind="image.generated" />'
    const result = parseMixedContent(content)

    expect(result[0].type).toBe('artifact')
    if (result[0].type === 'artifact') {
      expect(result[0].title).toBeUndefined()
    }
  })

  it('handles malformed tag gracefully', () => {
    const content = 'Text <artifact id="art_003"> more text'
    const result = parseMixedContent(content)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
  })

  it('handles missing id as text', () => {
    const content = '<artifact kind="design.canvas" />'
    const result = parseMixedContent(content)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
  })

  it('handles multiple artifacts', () => {
    const content = 'A <artifact id="a1" kind="x" /> B <artifact id="a2" kind="y" /> C'
    const result = parseMixedContent(content)

    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ type: 'text', text: 'A ' })
    expect(result[1]).toEqual({ type: 'artifact', id: 'a1', kind: 'x' })
    expect(result[2]).toEqual({ type: 'text', text: ' B ' })
    expect(result[3]).toEqual({ type: 'artifact', id: 'a2', kind: 'y' })
    expect(result[4]).toEqual({ type: 'text', text: ' C' })
  })
})
```

Run: `cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm test src/lib/parseMixedContent.test.ts`

Expected: FAIL - module not found

- [ ] **Step 2: 实现解析器**

```ts
// src/apps/web/src/lib/parseMixedContent.ts
import type { ContentSegment } from '@arkloop/shared'

const ARTIFACT_TAG_PATTERN = /<artifact\s+([^>]*)\/>/g
const ATTRIBUTE_PATTERN = /(\w+)="([^"]*)"/g

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const matches = attrString.matchAll(ATTRIBUTE_PATTERN)
  for (const match of matches) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

/**
 * 解析混合内容，提取内联 artifact 标记，拆分为文本段和产物段。
 *
 * 标准 Markdown 解析器遇到未知 XML 标签时行为不可控，因此必须在 Markdown
 * 解析前调用此函数做预处理拆分。
 */
export function parseMixedContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  const matches = Array.from(content.matchAll(ARTIFACT_TAG_PATTERN))
  let lastIndex = 0

  for (const match of matches) {
    const matchIndex = match.index ?? 0
    const matchText = match[0]

    // Text before the tag
    if (matchIndex > lastIndex) {
      segments.push({
        type: 'text',
        text: content.slice(lastIndex, matchIndex),
      })
    }

    // Parse attributes
    const attrs = parseAttributes(match[1])

    if (attrs.id && attrs.kind) {
      segments.push({
        type: 'artifact',
        id: attrs.id,
        kind: attrs.kind,
        title: attrs.title,
      })
    } else {
      // Malformed: keep as text
      segments.push({
        type: 'text',
        text: matchText,
      })
    }

    lastIndex = matchIndex + matchText.length
  }

  // Trailing text
  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      text: content.slice(lastIndex),
    })
  }

  return segments
}
```

Run: `cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm test src/lib/parseMixedContent.test.ts`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/apps/web/src/lib/parseMixedContent.ts src/apps/web/src/lib/parseMixedContent.test.ts
git commit -m "feat(web): add content parser for inline artifact markers"
```

---

## Task 5: InlineArtifactCard 组件

**Files:**
- Create: `src/apps/web/src/components/InlineArtifactCard.tsx`
- Create: `src/apps/web/src/components/InlineArtifactCard.test.tsx`

- [ ] **Step 1: 写组件测试**

```tsx
// src/apps/web/src/components/InlineArtifactCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineArtifactCard } from './InlineArtifactCard'

describe('InlineArtifactCard', () => {
  it('renders artifact title and kind', () => {
    render(
      <InlineArtifactCard
        resource={{
          id: 'art_001',
          kind: 'design.canvas',
          title: 'Test Design',
          producer: { type: 'agent', id: 'test' },
          fetchMode: 'inline-json',
          descriptor: {},
        }}
      />
    )

    expect(screen.getByText('Test Design')).toBeInTheDocument()
    expect(screen.getByText('design.canvas')).toBeInTheDocument()
  })

  it('falls back to Untitled when no title', () => {
    render(
      <InlineArtifactCard
        resource={{
          id: 'art_002',
          kind: 'image.generated',
          title: '',
          producer: { type: 'agent', id: 'test' },
          fetchMode: 'inline-json',
          descriptor: {},
        }}
      />
    )

    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(
      <InlineArtifactCard
        resource={{
          id: 'art_003',
          kind: 'document.markdown',
          title: 'Doc',
          producer: { type: 'agent', id: 'test' },
          fetchMode: 'inline-json',
          descriptor: {},
        }}
        onClick={onClick}
      />
    )

    fireEvent.click(screen.getByTestId('inline-artifact-art_003'))
    expect(onClick).toHaveBeenCalledWith('art_003')
  })

  it('shows image preview for object-blob image kinds', () => {
    render(
      <InlineArtifactCard
        resource={{
          id: 'art_004',
          kind: 'image.png',
          title: 'Photo',
          producer: { type: 'agent', id: 'test' },
          fetchMode: 'object-blob',
          descriptor: { key: 'test/photo.png' },
        }}
      />
    )

    const img = screen.getByAltText('Photo')
    expect(img).toBeInTheDocument()
  })

  it('does not show preview for non-image kinds', () => {
    render(
      <InlineArtifactCard
        resource={{
          id: 'art_005',
          kind: 'design.canvas',
          title: 'Canvas',
          producer: { type: 'agent', id: 'test' },
          fetchMode: 'inline-json',
          descriptor: {},
        }}
      />
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
```

Run: `cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm test src/components/InlineArtifactCard.test.tsx`

Expected: FAIL - component not found

- [ ] **Step 2: 实现组件**

```tsx
// src/apps/web/src/components/InlineArtifactCard.tsx
import { useState } from 'react'
import type { ArtifactResource } from '@arkloop/shared'

type Props = {
  resource: ArtifactResource
  title?: string
  onClick?: (id: string) => void
}

export function InlineArtifactCard({ resource, title, onClick }: Props) {
  const [imageError, setImageError] = useState(false)

  const displayTitle = title || resource.title || 'Untitled'
  const isObjectBlob = resource.fetchMode === 'object-blob'
  const isImageKind = resource.kind.startsWith('image.')
  const showPreview = isObjectBlob && isImageKind && !imageError

  return (
    <div
      className="inline-artifact"
      data-kind={resource.kind}
      data-testid={`inline-artifact-${resource.id}`}
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: '8px',
        padding: '12px',
        margin: '8px 0',
        cursor: onClick ? 'pointer' : 'default',
        background: 'var(--c-bg-sub)',
        transition: 'background 0.15s ease',
      }}
      onClick={() => onClick?.(resource.id)}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--c-bg-input)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--c-bg-sub)'
      }}
    >
      <div
        className="artifact-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span className="artifact-icon" style={{ fontSize: '20px', lineHeight: 1 }}>
          {kindIcon(resource.kind)}
        </span>
        <span
          className="artifact-title"
          style={{
            flex: 1,
            fontWeight: 500,
            color: 'var(--c-text-primary)',
            fontSize: '14px',
          }}
        >
          {displayTitle}
        </span>
        <span
          className="artifact-kind"
          style={{
            fontSize: '11px',
            color: 'var(--c-text-muted)',
            padding: '2px 8px',
            background: 'var(--c-bg-deep)',
            borderRadius: '4px',
            fontFamily: 'monospace',
          }}
        >
          {resource.kind}
        </span>
      </div>

      {showPreview && (
        <div className="artifact-preview" style={{ marginTop: '8px' }}>
          <img
            src={`/v1/artifacts/${resource.descriptor.key as string}/preview`}
            alt={displayTitle}
            style={{
              maxWidth: '100%',
              maxHeight: '200px',
              borderRadius: '4px',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={() => setImageError(true)}
          />
        </div>
      )}
    </div>
  )
}

function kindIcon(kind: string): string {
  if (kind.startsWith('image.')) return '🖼️'
  if (kind.startsWith('design.')) return '🎨'
  if (kind.startsWith('document.')) return '📄'
  if (kind.startsWith('code.')) return '💻'
  if (kind.startsWith('data.')) return '📊'
  return '📦'
}
```

Run: `cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm test src/components/InlineArtifactCard.test.tsx`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/apps/web/src/components/InlineArtifactCard.tsx src/apps/web/src/components/InlineArtifactCard.test.tsx
git commit -m "feat(web): add InlineArtifactCard component"
```

---

## Task 6: MixedContentRenderer 组件

**Files:**
- Create: `src/apps/web/src/components/MixedContentRenderer.tsx`
- Create: `src/apps/web/src/components/MixedContentRenderer.test.tsx`

- [ ] **Step 1: 写组件测试**

```tsx
// src/apps/web/src/components/MixedContentRenderer.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MixedContentRenderer } from './MixedContentRenderer'

// Mock MarkdownRenderer
vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

describe('MixedContentRenderer', () => {
  it('renders text only when no markers', () => {
    render(<MixedContentRenderer content="Hello world" />)

    expect(screen.getByTestId('markdown')).toHaveTextContent('Hello world')
  })

  it('renders inline artifact when resource exists', () => {
    render(
      <MixedContentRenderer
        content="Hello <artifact id=\"art_001\" kind=\"design.canvas\" title=\"Design\" /> world"
        artifacts={[
          {
            id: 'art_001',
            kind: 'design.canvas',
            title: 'Design',
            producer: { type: 'agent', id: 'test' },
            fetchMode: 'inline-json',
            descriptor: {},
          },
        ]}
      />
    )

    expect(screen.getByTestId('inline-artifact-art_001')).toBeInTheDocument()
    expect(screen.getByText('Design')).toBeInTheDocument()
  })

  it('renders broken placeholder when resource not found', () => {
    render(
      <MixedContentRenderer
        content="<artifact id=\"missing\" kind=\"x\" />"
        artifacts={[]}
      />
    )

    expect(screen.getByText(/产物引用失效/)).toBeInTheDocument()
  })

  it('calls onOpenArtifact when clicked', () => {
    const onOpen = vi.fn()
    render(
      <MixedContentRenderer
        content="<artifact id=\"art_002\" kind=\"image.png\" />"
        artifacts={[
          {
            id: 'art_002',
            kind: 'image.png',
            title: 'Photo',
            producer: { type: 'agent', id: 'test' },
            fetchMode: 'inline-json',
            descriptor: {},
          },
        ]}
        onOpenArtifact={onOpen}
      />
    )

    screen.getByTestId('inline-artifact-art_002').click()
    expect(onOpen).toHaveBeenCalledWith('art_002')
  })
})
```

Run: `cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm test src/components/MixedContentRenderer.test.tsx`

Expected: FAIL - module not found

- [ ] **Step 2: 实现组件**

```tsx
// src/apps/web/src/components/MixedContentRenderer.tsx
import { Fragment } from 'react'
import type { ArtifactResource } from '@arkloop/shared'
import { parseMixedContent } from '../lib/parseMixedContent'
import { MarkdownRenderer } from './MarkdownRenderer'
import { InlineArtifactCard } from './InlineArtifactCard'

type Props = {
  content: string
  artifacts?: ArtifactResource[]
  onOpenArtifact?: (id: string) => void
}

/**
 * 混合内容渲染器：将文本和 artifact 标记按原顺序渲染。
 *
 * 实现遵循 spec 5.2.1 的"先拆分，再分别渲染"原则：
 * 1. 预处理提取 <artifact> 标签，拆分为 Segment[]
 * 2. 文本段走 Markdown 渲染
 * 3. 产物段渲染 InlineArtifactCard
 * 4. 按原顺序拼接输出
 */
export function MixedContentRenderer({ content, artifacts, onOpenArtifact }: Props) {
  const segments = parseMixedContent(content)

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <Fragment key={index}>
              <MarkdownRenderer>{segment.text}</MarkdownRenderer>
            </Fragment>
          )
        }

        // segment.type === 'artifact'
        const resource = artifacts?.find((a) => a.id === segment.id)

        if (!resource) {
          return (
            <div
              key={index}
              className="artifact-broken"
              style={{
                padding: '12px',
                border: '1px dashed var(--c-status-error)',
                borderRadius: '8px',
                color: 'var(--c-status-error)',
                margin: '8px 0',
                fontSize: '13px',
              }}
            >
              产物引用失效: {segment.id}
            </div>
          )
        }

        return (
          <InlineArtifactCard
            key={index}
            resource={resource}
            title={segment.title}
            onClick={onOpenArtifact}
          />
        )
      })}
    </>
  )
}
```

Run: `cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm test src/components/MixedContentRenderer.test.tsx`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/apps/web/src/components/MixedContentRenderer.tsx src/apps/web/src/components/MixedContentRenderer.test.tsx
git commit -m "feat(web): add MixedContentRenderer for inline artifacts"
```

---

## Task 7: 集成到 AssistantMessage

**Files:**
- Modify: `src/apps/web/src/components/messagebubble/AssistantMessage.tsx`

- [ ] **Step 1: 修改 AssistantMessage 使用 MixedContentRenderer**

在 `AssistantMessage.tsx` 中：

1. 添加导入：

```tsx
import { MixedContentRenderer } from '../MixedContentRenderer'
```

2. 添加辅助函数（在组件外部）：

```tsx
function hasInlineArtifacts(content: string): boolean {
  return content.includes('<artifact')
}
```

3. 在渲染消息内容的位置，替换原有的 Markdown 渲染：

```tsx
{hasInlineArtifacts(displayContent) ? (
  <MixedContentRenderer
    content={displayContent}
    artifacts={artifacts?.map((a) => ({
      id: a.key,
      kind: a.mime_type || 'unknown',
      title: a.title || a.filename,
      producer: { type: 'agent', id: 'unknown' },
      fetchMode: 'object-blob',
      descriptor: { key: a.key },
    }))}
    onOpenArtifact={(id) => {
      const artifact = artifacts?.find((a) => a.key === id)
      if (artifact && onOpenDocument) {
        onOpenDocument(artifact)
      }
    }}
  />
) : (
  <MarkdownRenderer>{displayContent}</MarkdownRenderer>
)}
```

注意：`displayContent` 是 AssistantMessage 中计算出的最终显示文本。如果变量名不同，请使用实际使用的变量名。

过渡期映射说明：现有的 `ArtifactRef`（key, filename, mime_type, title, display）映射到新的 `ArtifactResource` 结构。当后端正式输出 `ArtifactResource` 数组后，此映射可移除。

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm type-check
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/apps/web/src/components/messagebubble/AssistantMessage.tsx
git commit -m "feat(web): integrate inline artifact rendering in AssistantMessage"
```

---

## Task 8: 端到端验证

- [ ] **Step 1: 运行所有后端测试**

```bash
cd /Users/huhui/Projects/Arkloop/src/services/api
go build ./cmd/api
```

Expected: 编译成功

- [ ] **Step 2: 运行所有前端测试**

```bash
cd /Users/huhui/Projects/Arkloop/src/apps/web
pnpm test src/lib/parseMixedContent.test.ts
pnpm test src/components/InlineArtifactCard.test.tsx
pnpm test src/components/MixedContentRenderer.test.tsx
```

Expected: All PASS

- [ ] **Step 3: 前端类型检查**

```bash
cd /Users/huhui/Projects/Arkloop/src/apps/web && pnpm type-check
cd /Users/huhui/Projects/Arkloop/src/apps/shared && pnpm type-check
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "test: verify artifact reference protocol e2e"
```

---

## Self-Review

### 1. Spec Coverage

| Spec 章节 | 覆盖任务 | 状态 |
|-----------|---------|------|
| 2. 核心思想（消息级协议） | 全部任务 | 已覆盖 |
| 3. 数据模型 | Task 1 (Go), Task 3 (TS) | 已覆盖 |
| 4. 插件 Viewer 注册 | Task 3 (类型定义) | 类型已覆盖，运行时后续 |
| 5.1 生产阶段 | Task 2 (消息中携带) | 已覆盖 |
| 5.2 消费阶段 - Chat 卡片渲染 | Task 4-7 | 已覆盖 |
| 5.2.1 内联 Artifact 标记 | Task 4-7 | 已覆盖 |
| 5.3 插件 payload | Task 1, 3 (类型定义) | 类型已覆盖 |
| 6. 权限与安全 | 文件类复用现有权限 | 已覆盖 |
| 7. 错误处理与降级 | Task 4 (解析错误), Task 6 (渲染降级) | 已覆盖 |
| 8. MVP - Artifact Resource/Handle 定义 | Task 1, 3 | 已覆盖 |
| 8. MVP - 兼容现有对象存储 | Task 7 (映射) | 已覆盖 |
| 8. MVP - 统一卡片渲染 | Task 5, 6 | 已覆盖 |
| 8. MVP - 插件 viewer 注册 & payload | 类型已定义 | 部分覆盖 |

### 2. Placeholder Scan

- 无 "TBD", "TODO", "implement later"
- 无 "Add appropriate error handling" 等模糊描述
- 每个测试步骤包含实际测试代码
- 每个实现步骤包含完整代码
- 无 "Similar to Task N" 引用

### 3. Type Consistency

- `ArtifactResource` 字段前后端一致（驼峰/下划线映射正确）
- `ContentSegment` 类型在 shared 和 web 中一致
- `parseMixedContent` 返回类型使用 `ContentSegment`

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-universal-artifact-reference.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you like?
