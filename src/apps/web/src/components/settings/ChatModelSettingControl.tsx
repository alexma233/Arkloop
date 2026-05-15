import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Zap } from 'lucide-react'
import {
  type LlmProvider,
  getAccountSettings,
  listLlmProviders,
  testLlmProviderModel,
  updateAccountSettings,
} from '../../api'
import { useLocale } from '../../contexts/LocaleContext'
import { AnimatedCheck } from '../AnimatedCheck'
import { SettingsModelDropdown } from './SettingsModelDropdown'
import { SettingsButton, SettingsIconButton } from './_SettingsButton'

type Props = {
  accessToken: string
  disabled?: boolean
}

export function ChatModelSettingControl({ accessToken, disabled = false }: Props) {
  const { t } = useLocale()
  const ds = t.desktopSettings
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [currentValue, setCurrentValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latency?: number; error?: string } | null>(null)
  const [testErrorMenuStyle, setTestErrorMenuStyle] = useState<CSSProperties | null>(null)
  const testErrorTriggerRef = useRef<HTMLDivElement>(null)
  const testErrorMenuRef = useRef<HTMLDivElement>(null)
  const testErrorOpen = testErrorMenuStyle !== null
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      listLlmProviders(accessToken).catch(() => [] as LlmProvider[]),
      getAccountSettings(accessToken).catch(() => null),
    ]).then(([provs, settings]) => {
      setProviders(provs)
      setCurrentValue(settings?.new_thread_chat_model ?? '')
      setLoaded(true)
    })
  }, [accessToken])

  const modelOptions = useMemo(
    () => providers.flatMap((p) =>
      p.models
        .filter((m) => m.show_in_picker)
        .map((m) => ({
          value: `${p.name}^${m.model}`,
          label: `${p.name} / ${m.model}`,
        })),
    ),
    [providers],
  )

  const modelSelection = useMemo(() => {
    if (!currentValue.includes('^')) return null
    const [providerName, ...rest] = currentValue.split('^')
    const modelName = rest.join('^')
    if (!providerName || !modelName) return null
    const provider = providers.find((item) => item.name === providerName)
    const model = provider?.models.find((item) => item.model === modelName)
    if (!provider || !model) return null
    return { provider, model }
  }, [currentValue, providers])

  const computeTestErrorMenuStyle = (): CSSProperties | null => {
    const trigger = testErrorTriggerRef.current
    if (!trigger || typeof window === 'undefined') return null

    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const gap = 6
    const width = Math.min(320, Math.max(200, window.innerWidth - margin * 2))
    const maxHeight = 160
    const spaceBelow = window.innerHeight - rect.bottom - margin - gap
    const spaceAbove = rect.top - margin - gap
    const openAbove = spaceBelow < maxHeight && spaceAbove > spaceBelow
    const top = openAbove
      ? Math.max(margin, rect.top - gap - maxHeight)
      : Math.min(rect.bottom + gap, window.innerHeight - margin - maxHeight)
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - margin - width)

    return {
      position: 'fixed',
      top,
      left,
      width,
      maxHeight,
      zIndex: 10000,
    }
  }

  useEffect(() => {
    if (!testErrorOpen) return

    const reposition = () => {
      const next = computeTestErrorMenuStyle()
      if (next) setTestErrorMenuStyle(next)
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        testErrorTriggerRef.current?.contains(target)
        || testErrorMenuRef.current?.contains(target)
      ) return
      setTestErrorMenuStyle(null)
    }

    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('mousedown', close, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('mousedown', close, true)
    }
  }, [testErrorOpen])

  const handleChange = async (value: string) => {
    setSaving(true)
    setTestResult(null)
    setTestErrorMenuStyle(null)
    try {
      await updateAccountSettings(accessToken, {
        new_thread_chat_model: value || null,
      })
      setCurrentValue(value)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!modelSelection) return
    setTesting(true)
    setTestErrorMenuStyle(null)
    try {
      const result = await testLlmProviderModel(accessToken, modelSelection.provider.id, modelSelection.model.id)
      setTestResult({ success: result.success, latency: result.latency_ms ?? undefined, error: result.error ?? undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setTestResult({ success: false, error: message })
    } finally {
      setTesting(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="flex min-w-0 items-center gap-2">
      <SettingsModelDropdown
        value={currentValue}
        options={modelOptions}
        placeholder={ds.chatModelPlatformDefault}
        disabled={disabled || saving}
        onChange={(value) => void handleChange(value)}
        showEmpty={false}
      />
      <SettingsIconButton
        label={ds.chatModel}
        onClick={() => {
          if (testResult?.success) {
            setTestResult(null)
            return
          }
          void handleTest()
        }}
        disabled={testing || (!modelSelection && !testResult)}
        className="h-9 w-9"
      >
        {testing
          ? <Loader2 size={14} className="animate-spin" />
          : testResult
            ? testResult.success
              ? <AnimatedCheck size={14} color="var(--c-status-success-text)" />
              : <X size={14} className="text-[var(--c-status-error-text)]" />
            : <Zap size={14} strokeWidth={1.5} />}
      </SettingsIconButton>
      {testResult && !testResult.success && !testing && (
        <div ref={testErrorTriggerRef}>
          <SettingsButton
            variant="danger"
            onClick={() => {
              if (testErrorOpen) {
                setTestErrorMenuStyle(null)
                return
              }
              const next = computeTestErrorMenuStyle()
              if (next) setTestErrorMenuStyle(next)
            }}
            className="h-9 shrink-0 text-xs"
          >
            Error
          </SettingsButton>
          {testErrorMenuStyle && createPortal(
            <div
              ref={testErrorMenuRef}
              className="dropdown-menu overflow-y-auto"
              style={{
                ...testErrorMenuStyle,
                border: '0.5px solid var(--c-border-subtle)',
                borderRadius: '10px',
                padding: '12px',
                background: 'var(--c-bg-menu)',
                boxShadow: 'var(--c-dropdown-shadow)',
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <pre className="whitespace-pre-wrap break-all text-xs text-[var(--c-text-secondary)]">{testResult.error ?? ''}</pre>
            </div>,
            document.body,
          )}
        </div>
      )}
    </div>
  )
}
