# 统一 Artifact 引用协议设计

> 日期：2026-05-08
> 目标：为插件系统、Agent、输入库、Chat UI 建立一套通用、可扩展的"生产物引用"协议，支持标签展示、Agent 识别、卡片渲染、点击唤起插件。

## 1. 背景与现状
- 现有 `artifact` 仅停留在"对象存储文件 + 前端引用"阶段。
- 插件系统已具备 `route / embedded-browser / hybrid` 三种展示模式，但缺少与 artifact 的绑定机制。
- 输入库、Agent、Chat UI 各自独立维护产物信息，无法跨场景共享。

## 2. 核心思想：消息级协议

Artifact 数据全部通过**消息/事件直接传递**，不引入额外的持久化层。

| 类型 | 处理方式 | 说明 |
|---|---|---|
| **文件类** (`object-blob`) | 上传至 `sandbox-artifacts` → 消息中携带 key | 复用现有对象存储，权限走现有 `run/account/share` 校验 |
| **内联数据** (`inline-json`) | 数据直接嵌入消息 | 小数据量，随消息生命周期 |
| **外部引用** (`external-url` / `api-resource`) | URL/API 参数嵌入消息 | 来源系统自行管理 |
| **插件解析** (`plugin-resolver`) | 插件 ID + 解析参数嵌入消息 | 由插件动态解析 |

系统里传递的是**轻量 Artifact Handle**（`{ id, kind }`）或**完整 Artifact Resource**（含 `fetchMode` / `descriptor`），消费时直接读取消息中的元数据，不再查数据库。渲染策略（预览、卡片类型、打开方式）由系统级 `KindRegistry` 根据 `kind` 决定，不随每个实例重复携带。

## 3. 数据模型

```ts
// 轻量引用，用于需要二次解析的场景
interface ArtifactHandle {
  id: string;          // 来源系统分配的标识（如对象存储 key）
  kind: string;        // 系统级分类，如 design.canvas、image.generated、document.markdown
}

// 完整资源描述，直接在消息/事件中携带
interface ArtifactResource {
  id: string;
  kind: string;
  version?: string;
  title: string;
  summary?: string;
  labels?: string[];
  mimeType?: string;

  // 来源
  producer: {
    type: 'agent' | 'plugin' | 'input-library' | 'import';
    id: string;
    runId?: string;
    pluginId?: string;
  };

  // 数据获取
  fetchMode: 'object-blob' | 'api-resource' | 'external-url' | 'plugin-resolver' | 'inline-json';
  descriptor: Record<string, unknown>;

  // 扩展能力
  capabilities?: string[];
}

// 系统级 Kind 注册表（非消息字段，系统启动时注册）
interface KindConfig {
  previewable: boolean;      // 是否支持内联预览
  cardType: string;          // 卡片模板类型
  defaultDisplay: string;    // 默认显示模式
  defaultViewer?: string;    // 默认打开插件
}
```

## 4. 系统级 Kind 注册表

渲染策略和打开方式由 `kind` 决定，不在每个 Artifact 实例上重复携带。

```ts
// 系统级配置（启动时注册，全局唯一）
const KindRegistry: Record<string, KindConfig> = {
  'image.png':     { previewable: true,  cardType: 'image',    defaultDisplay: 'inline' },
  'code.file':     { previewable: false, cardType: 'code',     defaultDisplay: 'attachment' },
  'design.canvas': { previewable: false, cardType: 'design',   defaultDisplay: 'modal',    defaultViewer: 'open-design' },
  'social.tweet':  { previewable: false, cardType: 'tweet',    defaultDisplay: 'inline' },
};

// 插件 Viewer 注册（补充 KindRegistry 的 defaultViewer）
interface ArtifactViewerRegistration {
  pluginId: string;
  supports: string[];        // 支持 kind 列表，支持通配符
  openMode: 'route' | 'embedded-browser' | 'hybrid' | 'panel';
  priority: number;
}
```

注册方式：系统启动时将 kind 配置加载到 `KindRegistry`；插件在 `plugin.yaml` 中声明 `artifactViewers` 以覆盖或补充默认 viewer。

## 5. 运行时数据流

### 5.1 生产阶段
1. 任何来源（Agent 工具、插件、输入库）先产出数据。
2. 构造 `ArtifactResource`（只包含数据核心字段：`id/kind/title/producer/fetchMode/descriptor`）。
   - 文件类：上传至 `sandbox-artifacts`，`fetchMode = 'object-blob'`，`descriptor = { key }`。
   - 非文件类：数据/URL/参数直接填入 `descriptor`。
3. 消息/事件里携带 `ArtifactResource` 或轻量的 `ArtifactHandle`。

### 5.2 消费阶段
1. **输入库标签**：直接读取 `ArtifactResource` 中的 `title/labels/kind`。
2. **Agent 上下文**：注入 `ArtifactResource` 列表，工具可直接读取 `descriptor`。
3. **Chat 卡片渲染**：按 `kind` 查 `KindRegistry` 获取渲染配置（`previewable`/`cardType`/`defaultDisplay`），支持**内联标记**与文本混合展示（详见 [5.2.1](#521-chat-内联-artifact-标记)）。
4. **点击打开**：统一动作
   ```
   openArtifact(resource, options)
   ├── pick viewer (default → candidates → fallback)
   ├── openPlugin(pluginId, { artifactContext })
   └── 降级：系统预览 / 下载
   ```

### 5.2.1 Chat 内联 Artifact 标记

Chat 消息支持在文本内容中内联嵌入 Artifact，使产物与描述文本一一对应，而非全部堆叠在消息尾部。

#### 标记语法

Content 字符串中使用自闭合 XML 标签：

```xml
<artifact id="art_canvas_001" kind="design.canvas" title="首页设计稿 v2" />
```

- `id`（必填）：Artifact 标识
- `kind`（必填）：系统级分类
- `title`（可选）：内联显示的短标题

#### 消息结构

```ts
interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;                   // 可能包含 <artifact> 标记
  artifacts?: ArtifactResource[];    // 消息附带的完整产物元数据
}
```

完整示例：

```ts
const message: ChatMessage = {
  id: 'msg_abc123',
  role: 'assistant',
  content: `我为你生成了首页设计稿：\n\n<artifact id="art_canvas_001" kind="design.canvas" title="首页设计稿 v2" />\n\n注意导航栏的配色需要调整：\n\n<artifact id="art_palette_002" kind="design.color-palette" title="推荐配色" />\n\n整体布局采用左右分栏。`,
  artifacts: [
    {
      id: 'art_canvas_001',
      kind: 'design.canvas',
      title: '首页设计稿 v2',
      producer: { type: 'agent', id: 'design_assistant', runId: 'run_xyz789' },
      fetchMode: 'object-blob',
      descriptor: { key: 'accounts/acct_001/...' }
    },
    {
      id: 'art_palette_002',
      kind: 'design.color-palette',
      title: '推荐配色',
      producer: { type: 'agent', id: 'design_assistant', runId: 'run_xyz789' },
      fetchMode: 'inline-json',
      descriptor: { colors: ['#FF5733', '#33FF57', '#3357FF'] }
    }
  ]
};
```

#### 渲染流程：先拆分，再分别渲染

标准 Markdown 解析器遇到未知 XML 标签时行为不可控（可能过滤、转义或补全标签），因此必须在 Markdown 解析前做预处理拆分：

```
content string
  → [预处理] 提取 <artifact> 标签，拆分为 Segment[]
  → [文本段] 走 Markdown 渲染
  → [产物段] 渲染 InlineArtifactCard 组件
  → 按原顺序拼接输出
```

#### 预处理与解析

```ts
interface TextSegment {
  type: 'text';
  text: string;
}

interface ArtifactSegment {
  type: 'artifact';
  id: string;
  kind: string;
  title?: string;
}

type Segment = TextSegment | ArtifactSegment;

function parseMixedContent(content: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /<artifact\s+([^>]*)\/>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // 1. 提取标记前的文本段
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        text: content.slice(lastIndex, match.index)
      });
    }

    // 2. 解析属性
    const attrs = parseAttributes(match[1]);
    segments.push({
      type: 'artifact',
      id: attrs.id,
      kind: attrs.kind,
      title: attrs.title
    });

    lastIndex = regex.lastIndex;
  }

  // 3. 尾部文本
  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return segments;
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(attrString)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}
```

#### React 渲染示例

```tsx
function ChatMessageContent({ message }: { message: ChatMessage }) {
  const segments = parseMixedContent(message.content);

  return (
    <div className="message-content">
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <Markdown key={i}>{seg.text}</Markdown>;
        }

        // 从 message.artifacts 查找完整元数据
        const resource = message.artifacts?.find(a => a.id === seg.id);
        if (!resource) {
          return <ArtifactBroken key={i} id={seg.id} />;
        }

        return (
          <InlineArtifactCard
            key={i}
            resource={resource}
            title={seg.title}
          />
        );
      })}
    </div>
  );
}
```

#### InlineArtifactCard 组件

```tsx
function InlineArtifactCard({
  resource,
  title
}: {
  resource: ArtifactResource;
  title?: string;
}) {
  const config = KindRegistry[resource.kind];
  const isObjectBlob = resource.fetchMode === 'object-blob';
  const isImageKind = resource.kind.startsWith('image.');
  const showPreview = config?.previewable && isObjectBlob && isImageKind;

  return (
    <div
      className="inline-artifact"
      data-kind={resource.kind}
      onClick={() => openArtifact(resource)}
    >
      <div className="artifact-row">
        <span className="artifact-icon">
          {kindIcon(resource.kind)}
        </span>
        <span className="artifact-title">
          {title || resource.title || 'Untitled'}
        </span>
        <span className="artifact-kind">{resource.kind}</span>
      </div>

      {showPreview && (
        <div className="artifact-preview">
          <img
            src={`/v1/artifacts/${resource.descriptor.key}/preview`}
            alt={title}
          />
        </div>
      )}
    </div>
  );
}
```

#### 错误处理

| 场景 | 行为 |
|------|------|
| `id` 在 `artifacts[]` 中找不到 | 渲染「产物引用失效」占位块，保留位置 |
| `kind` 与 `artifacts[]` 不一致 | 以 `artifacts[]` 为准，记录 warning |
| XML 格式错误（如缺少 `id`） | 跳过该标签，保留原始文本 |
| 正则解析失败 | 回退到纯文本渲染 |

#### 兼容性与降级

| 场景 | 行为 |
|------|------|
| 旧消息无 `<artifact>` 标记 | 回退到消息尾部堆叠渲染（`message.artifacts` 列表），无破坏性变更 |
| 新消息 `artifacts[]` 为空但有标记 | 所有标记渲染为「引用失效」占位块 |
| 混合使用 | 部分 artifact 内联、部分仅在 `artifacts[]` 尾部展示 |
| Markdown 安全模式 | 预处理在 Markdown 解析前执行，不受安全模式影响 |

### 5.3 插件 payload

插件 host 接收：

```ts
interface ArtifactContext {
  artifact: ArtifactResource;
  invocation: {
    sourceSurface: 'chat' | 'input-library' | 'workspace';
    trigger: 'click' | 'command' | 'agent';
    preferredMode?: 'route' | 'embedded-browser' | 'hybrid';
  };
  relatedArtifacts?: ArtifactResource[];
  sessionContext?: any;
}
```

## 6. 权限与安全

- **文件类 (`object-blob`)**：复用现有 `run/account/share` 校验，`/v1/artifacts/{key}` 已覆盖。
- **内联/外部类**：数据在消息中传递，权限由消息本身的可见性控制（同现有 thread/run 权限）。
- **Agent 工具**：只能消费消息中已授权的 `ArtifactResource`，不能绕过消息直连外部 URL。
- **插件**：接收受控上下文，如需 blob 通过受控 API 获取。

## 7. 错误处理与降级

| 场景 | 用户可见行为 |
|---|---|
| resource 元数据缺失 | 卡片显示"产物不可用" |
| viewer unavailable | 自动降级到候选 viewer → 系统预览 → 下载 |
| access denied（文件类） | 明确提示"无权访问" |
| fetch failed | 提供重试按钮 |

## 8. MVP 范围

### 首期必做
- `Artifact Resource` / `ArtifactHandle` 类型定义
- 消息中携带 `ArtifactResource` 数组
- 兼容现有对象存储 artifact（`fetch.mode = 'object-blob'`）
- 统一卡片渲染 + 推荐 viewer 打开
- Chat 内联标记解析与渲染
- 插件 viewer 注册 & payload 类型

### 首期不做
- artifact 全局索引 / 版本树 / 派生关系
- 跨账户共享 marketplace
- 插件自定义卡片渲染协议

## 9. 测试链路

1. Agent 生成 → Chat 卡片 → 点击打开推荐插件
2. 输入库 artifact → 标签正确 → Agent 读取
3. 推荐 viewer 缺失 → 正确降级
4. 无权限 artifact → 摘要可见但点击提示无权

---

**下一步**：本 spec 经审阅后，进入 implementation-plan 阶段，按最小 MVP 拆解任务清单并落地。
