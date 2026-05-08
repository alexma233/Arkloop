import type { KeyboardEvent, ReactNode } from 'react'
import { SettingsSwitch } from './_SettingsSwitch'

export function SettingsPage({
  title,
  children,
  className = 'max-w-[760px]',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 px-1 pb-8 ${className}`}>
      <h2 className="text-[24px] font-semibold leading-tight tracking-normal text-[var(--c-text-heading)]">
        {title}
      </h2>
      {children}
    </div>
  )
}

export function SettingsGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="pl-2.5 text-[13px] font-normal text-[var(--c-text-secondary)]">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)]">
      {children}
    </div>
  )
}

export function SettingsRow({
  title,
  description,
  control,
  disabled,
  onClick,
  children,
}: {
  title: string
  description?: ReactNode
  control?: ReactNode
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
}) {
  const interactive = onClick !== undefined
  const hasControl = control !== undefined

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || disabled) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onClick()
  }

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive && !disabled ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      className={[
        'group/settings-row relative grid items-center gap-3 px-5 py-4 outline-none transition-colors duration-[160ms] sm:gap-6 [&+&]:before:absolute [&+&]:before:left-5 [&+&]:before:right-5 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-[var(--c-border-subtle)] [&+&]:before:content-[\'\']',
        hasControl ? 'sm:grid-cols-[minmax(0,1fr)_auto]' : '',
        interactive && !disabled ? 'cursor-pointer hover:bg-[var(--c-bg-deep)]/25 focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]' : '',
        disabled ? 'pointer-events-none opacity-40' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--c-text-primary)]">{title}</div>
        {description && (
          <div className="mt-1 text-xs leading-5 text-[var(--c-text-tertiary)]">{description}</div>
        )}
        {children}
      </div>
      {hasControl && (
        <div className="flex min-w-0 items-center sm:justify-self-end" onClick={(event) => event.stopPropagation()}>
          {control}
        </div>
      )}
    </div>
  )
}

export function SettingsSwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  forceHover,
}: {
  title: string
  description?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  forceHover?: boolean
}) {
  const handleChange = (next: boolean) => {
    if (disabled) return
    onChange(next)
  }

  return (
    <SettingsRow
      title={title}
      description={description}
      disabled={disabled}
      onClick={() => handleChange(!checked)}
      control={<SettingsSwitch checked={checked} onChange={handleChange} disabled={disabled} forceHover={forceHover} />}
    />
  )
}
