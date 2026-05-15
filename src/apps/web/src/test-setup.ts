import React from 'react'
import { vi } from 'vitest'

// jsdom 不模拟 layout，Virtuoso 真实实现下视口高度为 0 不会渲染任何 item。
// 测试关心的是消息渲染结果，不是虚拟化行为本身，因此 mock 成全量渲染的简单 stub。
vi.mock('react-virtuoso', () => {
  type StubProps = {
    data?: readonly unknown[]
    itemContent?: (idx: number, item: unknown) => React.ReactNode
    computeItemKey?: (idx: number, item: unknown) => React.Key
  }
  const Virtuoso = React.forwardRef<unknown, StubProps>(function VirtuosoStub(
    { data, itemContent, computeItemKey },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: () => {},
      scrollIntoView: () => {},
      scrollTo: () => {},
      scrollBy: () => {},
    }))
    if (!data || !itemContent) return null
    return React.createElement(
      React.Fragment,
      null,
      data.map((item, idx) =>
        React.createElement(
          React.Fragment,
          { key: computeItemKey ? computeItemKey(idx, item) : idx },
          itemContent(idx, item),
        ),
      ),
    )
  })
  return { Virtuoso }
})

// jsdom 未实现 Blob URL；ArtifactIframe 等依赖此方法。
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (_blob: Blob) => 'blob:jsdom-polyfill',
  })
}
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (_url: string) => {},
  })
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    }),
  })
}

if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    writable: true,
    value: () => {},
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserver,
  })
}

// 测试默认用中文 locale
try {
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    get() { return 'zh-CN' },
  })
} catch {
  // navigator.language 可能不可写；直接设 localStorage fallback
  try {
    localStorage.setItem('arkloop:web:locale', 'zh')
  } catch {
    // ignore
  }
}
