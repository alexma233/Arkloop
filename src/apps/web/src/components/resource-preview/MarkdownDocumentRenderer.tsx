import { useMemo } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import type { ArtifactRef } from '../../storage'
import { isPlanTodoCompleted, parsePlanMarkdown, type PlanMetadata, type PlanTodo } from '../../planMetadata'

type Props = {
  content: string
  accessToken?: string
  artifacts?: ArtifactRef[]
  runId?: string
}

export function MarkdownDocumentRenderer({ content, accessToken = '', artifacts = [], runId }: Props) {
  const plan = useMemo(() => parsePlanMarkdown(content), [content])
  if (plan) {
    return (
      <PlanDocumentRenderer
        plan={plan}
        accessToken={accessToken}
        artifacts={artifacts}
        runId={runId}
      />
    )
  }

  return (
    <div data-preview-renderer="markdown" style={{ padding: '20px 28px' }}>
      <MarkdownRenderer
        content={content}
        artifacts={artifacts}
        accessToken={accessToken}
        runId={runId}
        compact
        allowHtml
      />
    </div>
  )
}

function TodoStatusIcon({ todo }: { todo: PlanTodo }) {
  const completed = isPlanTodoCompleted(todo.status)
  return (
    <span
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: completed ? '0.5px solid var(--c-accent)' : '1.4px solid var(--c-border-mid)',
        background: completed ? 'var(--c-accent)' : 'transparent',
        boxShadow: completed ? 'inset 0 0 0 3px var(--c-bg-page)' : 'none',
        flexShrink: 0,
        marginTop: 3,
      }}
    />
  )
}

function PlanTodoList({ todos }: { todos: PlanTodo[] }) {
  const visibleTodos = todos.filter((todo) => todo.content.trim() !== '')
  if (visibleTodos.length === 0) return null

  return (
    <section style={{ marginTop: 44, paddingTop: 20, borderTop: '0.5px solid var(--c-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 520, color: 'var(--c-text-secondary)' }}>
          {visibleTodos.length} To-dos
        </h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {visibleTodos.map((todo, index) => (
          <div key={todo.id || `${todo.content}-${index}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <TodoStatusIcon todo={todo} />
            <div style={{
              minWidth: 0,
              color: isPlanTodoCompleted(todo.status) ? 'var(--c-text-muted)' : 'var(--c-text-primary)',
              fontSize: 14,
              lineHeight: '21px',
              textDecoration: isPlanTodoCompleted(todo.status) ? 'line-through' : 'none',
              textDecorationColor: 'var(--c-border-mid)',
            }}>
              {todo.content}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PlanDocumentRenderer({
  plan,
  accessToken,
  artifacts,
  runId,
}: {
  plan: PlanMetadata
  accessToken: string
  artifacts: ArtifactRef[]
  runId?: string
}) {
  const body = plan.body.trim()

  return (
    <article
      data-preview-renderer="plan"
      style={{
        maxWidth: 840,
        margin: '0 auto',
        padding: '54px 56px 64px',
      }}
    >
      {plan.name ? (
        <h1 style={{ margin: '0 0 12px', color: 'var(--c-text-primary)', fontSize: 30, lineHeight: '38px', fontWeight: 680 }}>
          {plan.name}
        </h1>
      ) : null}
      {plan.overview ? (
        <p style={{ margin: '0 0 30px', color: 'var(--c-text-secondary)', fontSize: 16, lineHeight: '26px' }}>
          {plan.overview}
        </p>
      ) : null}
      {body ? (
        <div style={{ marginTop: plan.name || plan.overview ? 8 : 0 }}>
          <MarkdownRenderer
            content={body}
            artifacts={artifacts}
            accessToken={accessToken}
            runId={runId}
            compact
            allowHtml
          />
        </div>
      ) : null}
      <PlanTodoList todos={plan.todos} />
    </article>
  )
}
