import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { AssistantTurnUi } from '../assistantTurnSegments'

// fallback reserved space before the input area is measured
export const SCROLL_BOTTOM_PAD = 160

// top offset when pinning user prompt — clears the top gradient overlay (h-10 = 40px)
const SCROLL_TOP_OFFSET = 48
// pin 时 user prompt 顶部距视口顶部的距离。比 SCROLL_TOP_OFFSET 大，露出上一条 assistant 消息尾部。
const PROMPT_PIN_TOP_OFFSET = 160
const ANCHOR_SCROLL_MAX_MONITOR_FRAMES = 180
const ANCHOR_SCROLL_SETTLE_FRAMES = 10
const ANCHOR_SCROLL_TARGET_EPSILON = 0.5
const LAYOUT_SCROLL_WIDTH_EPSILON = 0.5
const resizeObserverBlockSizeCache = new WeakMap<Element, number>()

type ViewportAnchor = {
  element: HTMLElement | null
  top: number
  turnOffset: number | null
  path: number[] | null
}

function hasResizeObserverBlockChange(entry: ResizeObserverEntry): boolean {
  const borderBoxSize = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize
  const blockSize = borderBoxSize?.blockSize
    ?? entry.contentRect?.height
    ?? (entry.target instanceof HTMLElement ? entry.target.getBoundingClientRect().height : 0)
  const previous = resizeObserverBlockSizeCache.get(entry.target)
  resizeObserverBlockSizeCache.set(entry.target, blockSize)
  return previous == null || Math.abs(blockSize - previous) > 0.5
}

interface UseScrollPinOptions {
  messagesLoading?: boolean
  messages?: readonly unknown[]
  liveAssistantTurn?: AssistantTurnUi | null
  liveRunUiVisible?: boolean
  topLevelCodeExecutionsLength?: number
  promptPinningDisabled?: boolean
  // 跳到底部前先把虚拟化历史区瞬移到末尾，避免浏览器原生 smooth scroll 逐帧穿过几千 px
  // 触发大量挂载/卸载导致的「灰条 / 抖动」。由 MessageList 通过 imperative handle 提供。
  jumpHistoryToEnd?: () => void
}

export interface ScrollPinResult {
  bottomRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  lastUserMsgRef: React.RefObject<HTMLDivElement | null>
  lastUserPromptRef: React.RefObject<HTMLDivElement | null>
  inputAreaRef: React.RefObject<HTMLDivElement | null>
  copCodeExecScrollRef: React.RefObject<HTMLDivElement | null>
  spacerRef: React.RefObject<HTMLDivElement | null>
  forceInstantBottomScrollRef: React.MutableRefObject<boolean>
  wasLoadingRef: React.MutableRefObject<boolean>
  documentPanelScrollFrameRef: React.MutableRefObject<number | null>
  isAtBottomRef: React.MutableRefObject<boolean>
  programmaticScrollDepthRef: React.MutableRefObject<number>
  handleScrollContainerScroll: () => void
  captureViewportAnchor: () => void
  scrollToBottom: () => void
  activateAnchor: () => void
  syncBottomState: (el: HTMLDivElement) => void
  stabilizeDocumentPanelScroll: (trigger?: HTMLElement | null) => void
  subscribeIsAtBottom: (listener: () => void) => () => void
  getIsAtBottomSnapshot: () => boolean
}

export function useScrollPin(options: UseScrollPinOptions = {}): ScrollPinResult {
  const {
    messagesLoading = false,
    messages = [],
    liveAssistantTurn = null,
    liveRunUiVisible = false,
    topLevelCodeExecutionsLength = 0,
    promptPinningDisabled = false,
    jumpHistoryToEnd,
  } = options
  const jumpHistoryToEndRef = useRef<typeof jumpHistoryToEnd>(jumpHistoryToEnd)
  useEffect(() => {
    jumpHistoryToEndRef.current = jumpHistoryToEnd
  }, [jumpHistoryToEnd])
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastUserMsgRef = useRef<HTMLDivElement>(null)
  const lastUserPromptRef = useRef<HTMLDivElement>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)
  const copCodeExecScrollRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const forceInstantBottomScrollRef = useRef(false)
  const wasLoadingRef = useRef(false)
  const documentPanelScrollFrameRef = useRef<number | null>(null)
  const localExpansionActiveUntilRef = useRef(0)
  const isAtBottomRef = useRef(true)
  const isPhysicallyAtBottomRef = useRef(true)
  const isAtBottomListenersRef = useRef(new Set<() => void>())

  // anchor state (imperative, not React state — avoid re-renders on every scroll)
  const isAnchoredRef = useRef(false)
  const programmaticScrollDepthRef = useRef(0)
  const lastObservedScrollTopRef = useRef(0)
  const lastObservedScrollHeightRef = useRef(0)
  const lastContainerInlineSizeRef = useRef(0)
  // tracks whether streaming is active — only follow scroll during streaming
  const liveStreamActiveRef = useRef(false)
  const followLiveOutputRef = useRef(false)
  const bottomScrollFrameRef = useRef<number | null>(null)
  const bottomSmoothScrollMonitorFrameRef = useRef<number | null>(null)
  const bottomSmoothScrollPendingRef = useRef(false)
  const anchorScrollMonitorFrameRef = useRef<number | null>(null)
  const anchorScrollSettleFrameRef = useRef<number | null>(null)
  const anchorScrollSettleFramesRef = useRef(0)
  const anchorActivationPendingRef = useRef(false)
  const viewportAnchorRef = useRef<ViewportAnchor | null>(null)

  const inputAreaHeight = useCallback(() => {
    const inputArea = inputAreaRef.current
    if (!inputArea) return SCROLL_BOTTOM_PAD
    const height = inputArea.getBoundingClientRect().height
    return Number.isFinite(height) && height > 0 ? height : SCROLL_BOTTOM_PAD
  }, [])

  const maxScrollTop = useCallback((container: HTMLDivElement) => {
    return Math.max(0, container.scrollHeight - container.clientHeight)
  }, [])

  const rememberScrollTop = useCallback((container: HTMLDivElement | null) => {
    if (!container) return
    lastObservedScrollTopRef.current = container.scrollTop
  }, [])

  const subscribeIsAtBottom = useCallback((listener: () => void) => {
    isAtBottomListenersRef.current.add(listener)
    return () => {
      isAtBottomListenersRef.current.delete(listener)
    }
  }, [])

  const getIsAtBottomSnapshot = useCallback(() => isAtBottomRef.current, [])

  const setAtBottomState = useCallback((atBottom: boolean) => {
    if (isAtBottomRef.current === atBottom) return
    isAtBottomRef.current = atBottom
    for (const listener of isAtBottomListenersRef.current) {
      listener()
    }
  }, [])

  const anchorScrollTopRef = useRef<() => number | null>(() => null)

  const syncBottomState = useCallback((el: HTMLDivElement) => {
    const physicallyAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80
    isPhysicallyAtBottomRef.current = physicallyAtBottom
    // anchored 模式下：scrollTop 仍贴着 anchor 目标位置（容差内）即视为「锁定到 prompt」=「at bottom」。
    // 用户手动滚开后 anchored 仍然 true，但 anchoredViewLocked 因距离过大变成 false，下箭头按钮会出现。
    let anchoredViewLocked = false
    if (isAnchoredRef.current && !followLiveOutputRef.current) {
      const target = anchorScrollTopRef.current()
      if (target != null && Math.abs(el.scrollTop - target) <= 16) {
        anchoredViewLocked = true
      }
    }
    const atBottom = physicallyAtBottom || anchoredViewLocked
    setAtBottomState(atBottom)
  }, [setAtBottomState])

  const shouldStickToBottom = useCallback(() => {
    return followLiveOutputRef.current || (isAtBottomRef.current && isPhysicallyAtBottomRef.current)
  }, [])

  const syncBottomStateFromContainer = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    syncBottomState(container)
  }, [syncBottomState])

  const isLayoutWidthScroll = useCallback((container: HTMLDivElement) => {
    const width = container.clientWidth
    const previousWidth = lastContainerInlineSizeRef.current
    lastContainerInlineSizeRef.current = width
    return previousWidth > 0 && Math.abs(width - previousWidth) > LAYOUT_SCROLL_WIDTH_EPSILON
  }, [])

  // 识别由 scrollHeight 变化引起的被动 scrollTop 修正。
  // 虚拟化场景下，Virtuoso 在以下情况会主动调 scrollTop 来保持视口内容稳定：
  //   1) item 测量后真实高度 > 估算：上方 item 高度增加 → scrollHeight 增加，scrollTop 也增加
  //   2) item 测量后真实高度 < 估算：上方 item 高度减少 → scrollHeight 减少，scrollTop 也减少
  //   3) item 滚出 overscan 卸载、placeholder 替代：高度短暂抖动，scrollTop 跟随补偿
  // 必须双向识别（同号 + 同幅度），否则向上滚遇到反向修正时会被当成「用户额外向上滚」，
  // 错误触发 userScrolledUp 切换 / collapseSpacer / anchor 重置。
  const isHeightCorrectionScroll = useCallback((container: HTMLDivElement, prevScrollTop: number): boolean => {
    const currentHeight = container.scrollHeight
    const previousHeight = lastObservedScrollHeightRef.current
    lastObservedScrollHeightRef.current = currentHeight
    if (previousHeight <= 0) return false
    const scrollTopDelta = container.scrollTop - prevScrollTop
    const heightDelta = currentHeight - previousHeight
    if (Math.abs(heightDelta) < 1) return false
    if (Math.sign(scrollTopDelta) !== Math.sign(heightDelta)) return false
    return Math.abs(Math.abs(scrollTopDelta) - Math.abs(heightDelta)) < 2
  }, [])

  const isLocalExpansionActive = useCallback(() => performance.now() < localExpansionActiveUntilRef.current, [])

  const clearBottomScrollFrame = useCallback(() => {
    if (bottomScrollFrameRef.current === null) return
    cancelAnimationFrame(bottomScrollFrameRef.current)
    bottomScrollFrameRef.current = null
    bottomSmoothScrollPendingRef.current = false
  }, [])

  const clearBottomSmoothScrollMonitor = useCallback(() => {
    bottomSmoothScrollPendingRef.current = false
    if (bottomSmoothScrollMonitorFrameRef.current === null) return
    cancelAnimationFrame(bottomSmoothScrollMonitorFrameRef.current)
    bottomSmoothScrollMonitorFrameRef.current = null
    programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
  }, [])

  const isBottomSmoothScrolling = useCallback(() => {
    return bottomSmoothScrollPendingRef.current || bottomSmoothScrollMonitorFrameRef.current !== null
  }, [])

  const clearAnchorScrollMonitor = useCallback(() => {
    if (anchorScrollMonitorFrameRef.current === null) return
    cancelAnimationFrame(anchorScrollMonitorFrameRef.current)
    anchorScrollMonitorFrameRef.current = null
    programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
  }, [])

  const isAnchorAnimating = useCallback(() => anchorScrollMonitorFrameRef.current !== null, [])

  const clearAnchorScrollSettleGuard = useCallback(() => {
    if (anchorScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(anchorScrollSettleFrameRef.current)
      anchorScrollSettleFrameRef.current = null
    }
    anchorScrollSettleFramesRef.current = 0
  }, [])

  const startAnchorScrollSettleGuard = useCallback(() => {
    clearAnchorScrollSettleGuard()
    anchorScrollSettleFramesRef.current = ANCHOR_SCROLL_SETTLE_FRAMES
    const tick = () => {
      anchorScrollSettleFramesRef.current = Math.max(0, anchorScrollSettleFramesRef.current - 1)
      if (anchorScrollSettleFramesRef.current <= 0) {
        anchorScrollSettleFrameRef.current = null
        return
      }
      anchorScrollSettleFrameRef.current = requestAnimationFrame(tick)
    }
    anchorScrollSettleFrameRef.current = requestAnimationFrame(tick)
  }, [clearAnchorScrollSettleGuard])

  const scrollViewportToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = scrollContainerRef.current
    const bottom = bottomRef.current
    if (!container) return
    if (isAnchoredRef.current && !followLiveOutputRef.current) return

    clearAnchorScrollMonitor()
    if (behavior === 'instant') {
      clearBottomScrollFrame()
      clearBottomSmoothScrollMonitor()
    }

    const targetScroll = maxScrollTop(container)
    programmaticScrollDepthRef.current++

    if (behavior === 'instant') {
      container.scrollTop = targetScroll
      bottom?.scrollIntoView({ behavior: 'instant' })
    } else {
      container.scrollTo({ top: targetScroll, behavior })
    }
    rememberScrollTop(container)

    requestAnimationFrame(() => {
      programmaticScrollDepthRef.current--
      rememberScrollTop(container)
      syncBottomState(container)
    })
  }, [clearAnchorScrollMonitor, clearBottomScrollFrame, clearBottomSmoothScrollMonitor, maxScrollTop, rememberScrollTop, syncBottomState])

  const animateBottomIntoPlace = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      bottomSmoothScrollPendingRef.current = false
      return
    }

    clearBottomSmoothScrollMonitor()

    programmaticScrollDepthRef.current++
    setAtBottomState(true)
    let targetScroll = maxScrollTop(container)
    container.scrollTo({ top: targetScroll, behavior: 'smooth' })
    rememberScrollTop(container)

    let frame = 0
    let stableFrames = 0
    let lastScrollTop = container.scrollTop
    let observedMovement = false
    const tick = () => {
      const currentContainer = scrollContainerRef.current
      if (!currentContainer) {
        bottomSmoothScrollMonitorFrameRef.current = null
        programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
        return
      }

      frame += 1
      const currentScrollTop = currentContainer.scrollTop
      const latestTargetScroll = maxScrollTop(currentContainer)
      if (Math.abs(latestTargetScroll - targetScroll) > ANCHOR_SCROLL_TARGET_EPSILON) {
        targetScroll = latestTargetScroll
        stableFrames = 0
        observedMovement = false
        currentContainer.scrollTo({ top: targetScroll, behavior: 'smooth' })
      }

      const nearTarget = Math.abs(currentScrollTop - targetScroll) <= ANCHOR_SCROLL_TARGET_EPSILON
      const stationary = Math.abs(currentScrollTop - lastScrollTop) <= 0.5
      if (!stationary) observedMovement = true
      stableFrames = nearTarget || stationary ? stableFrames + 1 : 0
      lastScrollTop = currentScrollTop

      if (observedMovement && stableFrames >= 2 && !nearTarget && frame < ANCHOR_SCROLL_MAX_MONITOR_FRAMES) {
        stableFrames = 0
        observedMovement = false
        currentContainer.scrollTo({ top: targetScroll, behavior: 'smooth' })
      }

      if (nearTarget || frame >= ANCHOR_SCROLL_MAX_MONITOR_FRAMES) {
        const finalTargetScroll = maxScrollTop(currentContainer)
        if (Math.abs(currentContainer.scrollTop - finalTargetScroll) > ANCHOR_SCROLL_TARGET_EPSILON) {
          currentContainer.scrollTop = finalTargetScroll
        }
        bottomSmoothScrollMonitorFrameRef.current = null
        programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
        rememberScrollTop(currentContainer)
        syncBottomState(currentContainer)
        return
      }

      bottomSmoothScrollMonitorFrameRef.current = requestAnimationFrame(tick)
    }

    bottomSmoothScrollMonitorFrameRef.current = requestAnimationFrame(tick)
  }, [clearBottomSmoothScrollMonitor, maxScrollTop, rememberScrollTop, setAtBottomState, syncBottomState])

  // compute element's scrollTop-relative offset (robust against positioned parents)
  const offsetInContainer = useCallback((el: HTMLElement): number => {
    const container = scrollContainerRef.current
    if (!container) return 0
    return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
  }, [])

  const contentRoot = useCallback((): HTMLElement | null => {
    const container = scrollContainerRef.current
    if (!container) return null
    const first = container.firstElementChild
    return first instanceof HTMLElement ? first : null
  }, [])

  const pathFromRoot = useCallback((root: HTMLElement, node: HTMLElement): number[] | null => {
    if (node === root || !root.contains(node)) return null
    const path: number[] = []
    let current: HTMLElement | null = node
    while (current && current !== root) {
      const parent: HTMLElement | null = current.parentElement
      if (!parent) return null
      const index = Array.prototype.indexOf.call(parent.children, current)
      if (index < 0) return null
      path.unshift(index)
      current = parent
    }
    return current === root ? path : null
  }, [])

  const resolvePathFromRoot = useCallback((root: HTMLElement, path: number[] | null): HTMLElement | null => {
    if (!path || path.length === 0) return null
    let current: HTMLElement | null = root
    for (const index of path) {
      const next: Element | null = current.children.item(index)
      if (!(next instanceof HTMLElement)) return null
      current = next
    }
    return current
  }, [])

  const shouldPreserveViewport = useCallback(() => {
    if (anchorActivationPendingRef.current) return false
    if (followLiveOutputRef.current || isAtBottomRef.current) return false
    // anchored 但用户已经滑开 anchor 区时，仍然要做 viewport anchor 保护——
    // 否则 lastTurn 自身高度增长（如流式 + 上方展开）会把用户阅读位置推走。
    return true
  }, [])

  const findViewportAnchor = useCallback((): ViewportAnchor | null => {
    const container = scrollContainerRef.current
    // 把搜索根从 contentRoot 收窄到 lastUserMsgRef（lastTurn 容器）。
    // 历史区已经虚拟化，里面的 DOM 元素会随 Virtuoso 卸载，pathFromRoot 记录的 children index 无法稳定恢复。
    // viewport anchor 的核心场景是「流式增长时用户视口不漂移」，目标元素必然在 lastTurn 子树内，收窄不会丢失保护。
    // fallback 到 contentRoot 是 lastTurn 还没 mount 的过渡帧兜底。
    const root = lastUserMsgRef.current ?? contentRoot()
    if (!container || !root) return null

    const containerRect = container.getBoundingClientRect()
    const markerTop = Math.min(
      Math.max(container.clientHeight - 1, 0),
      Math.max(16, SCROLL_TOP_OFFSET + 8),
    )
    const topEdge = containerRect.top + 1
    const bottomEdge = containerRect.bottom - 1
    const isVisibleCandidate = (node: HTMLElement | null): node is HTMLElement => {
      if (!node) return false
      if (node === container || node === root) return false
      if (!root.contains(node)) return false
      if (node === bottomRef.current || node === spacerRef.current) return false
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 && rect.height <= 0) return false
      if (rect.bottom <= topEdge) return false
      if (rect.top >= bottomEdge) return false
      return true
    }

    const candidateDepth = (node: HTMLElement) => {
      let depth = 0
      let parent = node.parentElement
      while (parent && parent !== root) {
        depth += 1
        parent = parent.parentElement
      }
      return depth
    }

    const chooseBetterCandidate = (
      current: { element: HTMLElement; top: number; depth: number } | null,
      next: { element: HTMLElement; top: number; depth: number },
    ) => {
      if (current == null) return next
      const currentStartsInside = current.top >= 0
      const nextStartsInside = next.top >= 0
      if (currentStartsInside !== nextStartsInside) {
        return nextStartsInside ? next : current
      }
      if (currentStartsInside && nextStartsInside) {
        if (next.top < current.top - 0.5) return next
        if (Math.abs(next.top - current.top) <= 0.5 && next.depth > current.depth) return next
        return current
      }
      if (next.top > current.top + 0.5) return next
      if (Math.abs(next.top - current.top) <= 0.5 && next.depth > current.depth) return next
      return current
    }

    const samplePoints = [
      topEdge + container.clientHeight * 0.45,
      topEdge + container.clientHeight * 0.3,
      topEdge + Math.min(32, Math.max(12, container.clientHeight * 0.12)),
    ]
    const sampleX = containerRect.left + Math.max(16, Math.min(containerRect.width - 16, containerRect.width * 0.5))

    let best: { element: HTMLElement; top: number; depth: number } | null = null

    if (typeof document.elementFromPoint === 'function') {
      for (const sampleY of samplePoints) {
        const hit = document.elementFromPoint(sampleX, sampleY)
        if (!(hit instanceof HTMLElement) || !container.contains(hit)) continue

        let candidate: HTMLElement | null = hit
        while (candidate && candidate !== container && candidate !== root) {
          if (isVisibleCandidate(candidate)) {
            best = chooseBetterCandidate(best, {
              element: candidate,
              top: candidate.getBoundingClientRect().top - containerRect.top,
              depth: candidateDepth(candidate),
            })
          }
          candidate = candidate.parentElement as HTMLElement | null
        }
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let current = walker.nextNode()
    while (current) {
      if (current instanceof HTMLElement && isVisibleCandidate(current)) {
        best = chooseBetterCandidate(best, {
          element: current,
          top: current.getBoundingClientRect().top - containerRect.top,
          depth: candidateDepth(current),
        })
      }
      current = walker.nextNode()
    }

    if (best) {
      const turn = lastUserMsgRef.current
      let turnOffset: number | null = null
      if (turn) {
        const markerScrollTop = container.scrollTop + markerTop
        const turnTop = offsetInContainer(turn)
        const turnBottom = turnTop + turn.getBoundingClientRect().height
        if (markerScrollTop >= turnTop && markerScrollTop <= turnBottom) {
          turnOffset = markerScrollTop - turnTop
        }
      }
      return {
        element: best.element,
        top: best.top,
        turnOffset,
        path: pathFromRoot(root, best.element),
      }
    }
    return null
  }, [contentRoot, offsetInContainer, pathFromRoot])

  const captureViewportAnchor = useCallback(() => {
    viewportAnchorRef.current = shouldPreserveViewport() ? findViewportAnchor() : null
  }, [findViewportAnchor, shouldPreserveViewport])

  const preserveViewportAnchor = useCallback(() => {
    if (!shouldPreserveViewport()) {
      viewportAnchorRef.current = null
      return
    }

    const container = scrollContainerRef.current
    if (!container) return

    const anchor = viewportAnchorRef.current ?? findViewportAnchor()
    if (!anchor) return

    // 必须与 findViewportAnchor 使用同一个 root，否则 anchor.path（children index 序列）无法解析。
    const root = lastUserMsgRef.current ?? contentRoot()
    const containerRect = container.getBoundingClientRect()
    // anchor 元素必须仍在视口附近才能用作 layout shift 补偿。
    // 用户已经滚出 lastTurn 视口（如向上翻到历史区）时，缓存的 anchor 元素留在视口下方很远，
    // 不能再用它做 scrollTop 修正——否则 delta 是用户的整体滚动距离，把用户硬拉回去。
    const ANCHOR_VIEWPORT_BUFFER = 200
    const isAnchorNearViewport = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect()
      return rect.bottom > containerRect.top - ANCHOR_VIEWPORT_BUFFER && rect.top < containerRect.bottom + ANCHOR_VIEWPORT_BUFFER
    }
    const currentAnchor = (() => {
      if (
        anchor.element &&
        anchor.element.isConnected &&
        container.contains(anchor.element) &&
        isAnchorNearViewport(anchor.element)
      ) {
        return anchor
      }
      if (root) {
        const resolved = resolvePathFromRoot(root, anchor.path)
        if (
          resolved &&
          resolved.isConnected &&
          container.contains(resolved) &&
          isAnchorNearViewport(resolved)
        ) {
          return {
            element: resolved,
            top: anchor.top,
            turnOffset: anchor.turnOffset,
            path: anchor.path,
          }
        }
      }
      return findViewportAnchor()
    })()

    if (currentAnchor?.element && container.contains(currentAnchor.element)) {
      const nextTop = currentAnchor.element.getBoundingClientRect().top - containerRect.top
      const delta = nextTop - anchor.top
      if (Math.abs(delta) <= 0.5) {
        viewportAnchorRef.current = {
          element: currentAnchor.element,
          top: nextTop,
          turnOffset: currentAnchor.turnOffset ?? anchor.turnOffset,
          path: currentAnchor.path ?? anchor.path,
        }
        return
      }

      viewportAnchorRef.current = {
        element: currentAnchor.element,
        top: anchor.top,
        turnOffset: currentAnchor.turnOffset ?? anchor.turnOffset,
        path: currentAnchor.path ?? anchor.path,
      }
      programmaticScrollDepthRef.current++
      container.scrollTop += delta
      rememberScrollTop(container)
      syncBottomState(container)
      if (shouldPreserveViewport()) {
        captureViewportAnchor()
      }
      requestAnimationFrame(() => {
        programmaticScrollDepthRef.current--
        const freshContainer = scrollContainerRef.current
        if (!freshContainer) return
        rememberScrollTop(freshContainer)
        syncBottomState(freshContainer)
      })
      return
    }

    // 缓存的 anchor 完全失效（元素已离开视口很远），不要 fallback 到 lastTurn turnOffset——
    // 那会把用户从历史区强行滚回 lastTurn 顶部。直接重置缓存让下次 capture 重新建立。
    viewportAnchorRef.current = null
  }, [captureViewportAnchor, contentRoot, findViewportAnchor, rememberScrollTop, resolvePathFromRoot, shouldPreserveViewport, syncBottomState])

  // spacer 常驻：填补 viewport 与 (turn + input) 的差，留 PROMPT_PIN_TOP_OFFSET 给上一条尾部。
  // 没有棘轮、没有用户滚动消耗，turn/viewport/input 任一变化都重新计算。
  const recalcSpacer = useCallback(() => {
    const spacer = spacerRef.current
    const container = scrollContainerRef.current
    const turn = lastUserMsgRef.current
    if (!spacer || !container) return

    if (!isAnchoredRef.current || !turn) {
      spacer.style.height = '0px'
      return
    }

    const viewportH = container.clientHeight
    const turnH = turn.getBoundingClientRect().height
    const needed = Math.max(0, viewportH - turnH - inputAreaHeight() - PROMPT_PIN_TOP_OFFSET)
    spacer.style.height = needed + 'px'
  }, [inputAreaHeight])

  // scroll so that the user prompt top sits at PROMPT_PIN_TOP_OFFSET below the viewport top.
  // 流式期间长 turn 跟随到底部展示最新输出。
  const anchorScrollTop = useCallback((): number | null => {
    const container = scrollContainerRef.current
    const turn = lastUserMsgRef.current
    const prompt = lastUserPromptRef.current
    if (!container || !turn) return null

    const viewportH = container.clientHeight
    const turnH = turn.getBoundingClientRect().height
    const turnTop = offsetInContainer(turn)
    const promptTop = offsetInContainer(prompt ?? turn)

    if (followLiveOutputRef.current && liveStreamActiveRef.current && turnH > viewportH) {
      return turnTop + turnH - viewportH
    }
    return Math.max(0, promptTop - PROMPT_PIN_TOP_OFFSET)
  }, [offsetInContainer])

  // 同步 anchorScrollTop 到 ref，让 syncBottomState 能读取最新值而不形成循环依赖。
  useEffect(() => {
    anchorScrollTopRef.current = anchorScrollTop
  }, [anchorScrollTop])

  const scrollToAnchor = useCallback(() => {
    const container = scrollContainerRef.current
    const targetScroll = anchorScrollTop()
    if (!container || targetScroll == null) return
    if (Math.abs(container.scrollTop - targetScroll) <= 0.5) {
      syncBottomState(container)
      return
    }

    clearAnchorScrollMonitor()

    programmaticScrollDepthRef.current++
    container.scrollTop = targetScroll
    rememberScrollTop(container)
    requestAnimationFrame(() => {
      programmaticScrollDepthRef.current--
      rememberScrollTop(container)
      syncBottomState(container)
    })
  }, [anchorScrollTop, clearAnchorScrollMonitor, rememberScrollTop, syncBottomState])

  const animateAnchorIntoPlace = useCallback(() => {
    const container = scrollContainerRef.current
    const initialTargetScroll = anchorScrollTop()
    if (!container || initialTargetScroll == null) return

    clearAnchorScrollMonitor()

    if (Math.abs(container.scrollTop - initialTargetScroll) <= ANCHOR_SCROLL_TARGET_EPSILON) {
      scrollToAnchor()
      return
    }

    programmaticScrollDepthRef.current++
    setAtBottomState(true)
    let targetScroll = initialTargetScroll
    container.scrollTo({ top: targetScroll, behavior: 'smooth' })
    rememberScrollTop(container)

    let frame = 0
    let stableFrames = 0
    let lastScrollTop = container.scrollTop
    let observedMovement = false
    const tick = () => {
      const currentContainer = scrollContainerRef.current
      if (!currentContainer) {
        anchorScrollMonitorFrameRef.current = null
        programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
        return
      }

      frame += 1
      const currentScrollTop = currentContainer.scrollTop
      const latestTargetScroll = anchorScrollTop()
      if (
        latestTargetScroll != null &&
        Math.abs(latestTargetScroll - targetScroll) > ANCHOR_SCROLL_TARGET_EPSILON
      ) {
        targetScroll = latestTargetScroll
        stableFrames = 0
        observedMovement = false
        currentContainer.scrollTo({ top: targetScroll, behavior: 'smooth' })
      }
      const nearTarget = Math.abs(currentScrollTop - targetScroll) <= ANCHOR_SCROLL_TARGET_EPSILON
      const stationary = Math.abs(currentScrollTop - lastScrollTop) <= 0.5
      if (!stationary) observedMovement = true
      stableFrames = nearTarget || stationary ? stableFrames + 1 : 0
      lastScrollTop = currentScrollTop

      if (observedMovement && stableFrames >= 2 && !nearTarget && frame < ANCHOR_SCROLL_MAX_MONITOR_FRAMES) {
        stableFrames = 0
        observedMovement = false
        currentContainer.scrollTo({ top: targetScroll, behavior: 'smooth' })
      }

      if (nearTarget || frame >= ANCHOR_SCROLL_MAX_MONITOR_FRAMES) {
        const finalTargetScroll = anchorScrollTop() ?? targetScroll
        if (Math.abs(currentContainer.scrollTop - finalTargetScroll) > ANCHOR_SCROLL_TARGET_EPSILON) {
          currentContainer.scrollTop = finalTargetScroll
        }
        anchorScrollMonitorFrameRef.current = null
        programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
        startAnchorScrollSettleGuard()
        rememberScrollTop(currentContainer)
        syncBottomState(currentContainer)
        return
      }

      anchorScrollMonitorFrameRef.current = requestAnimationFrame(tick)
    }

    anchorScrollMonitorFrameRef.current = requestAnimationFrame(tick)
  }, [anchorScrollTop, clearAnchorScrollMonitor, rememberScrollTop, scrollToAnchor, setAtBottomState, startAnchorScrollSettleGuard, syncBottomState])

  const collapseSpacer = useCallback(() => {
    clearBottomScrollFrame()
    clearBottomSmoothScrollMonitor()
    clearAnchorScrollMonitor()
    clearAnchorScrollSettleGuard()
    isAnchoredRef.current = false
    anchorActivationPendingRef.current = false
    viewportAnchorRef.current = null
    if (spacerRef.current) spacerRef.current.style.height = '0px'
  }, [clearAnchorScrollMonitor, clearAnchorScrollSettleGuard, clearBottomScrollFrame, clearBottomSmoothScrollMonitor])

  // scroll-to-bottom button: collapse spacer and scroll to actual bottom
  const scrollToBottom = useCallback(() => {
    const shouldAnimate = !liveStreamActiveRef.current
    collapseSpacer()
    followLiveOutputRef.current = true
    viewportAnchorRef.current = null
    clearBottomScrollFrame()
    // 关键：动画开始前先让 Virtuoso 用 scrollToIndex 把历史区跳到末尾。
    // 浏览器原生 smooth scroll 逐帧改 scrollTop，跨越数千 px 时会让 Virtuoso 一帧一帧 mount
    // 途经的消息组件（Markdown/iframe），跟不上就出灰条。Virtuoso 自带的 scrollToIndex 知道目标
    // index，会直接挂载目标区域、跳过中间项的逐帧挂载。
    // 之后再让 useScrollPin 平滑滚到「真正的最底部」（最后 turn 的尾巴 + 底 padding）。
    jumpHistoryToEndRef.current?.()
    bottomSmoothScrollPendingRef.current = shouldAnimate
    bottomScrollFrameRef.current = requestAnimationFrame(() => {
      bottomScrollFrameRef.current = null
      if (shouldAnimate) {
        animateBottomIntoPlace()
      } else {
        bottomSmoothScrollPendingRef.current = false
        scrollViewportToBottom('instant')
      }
      setAtBottomState(true)
    })
  }, [animateBottomIntoPlace, clearBottomScrollFrame, collapseSpacer, scrollViewportToBottom, setAtBottomState])

  // activate anchor on the current lastUserMsg turn
  const activateAnchor = useCallback(() => {
    if (promptPinningDisabled) {
      scrollToBottom()
      return
    }

    clearBottomScrollFrame()
    clearBottomSmoothScrollMonitor()
    anchorActivationPendingRef.current = true
    isAnchoredRef.current = true
    followLiveOutputRef.current = false
    viewportAnchorRef.current = null
    setAtBottomState(true)
    const finishActivation = (remainingFrames: number) => {
      if (!anchorActivationPendingRef.current) return
      const turn = lastUserMsgRef.current
      if (!turn) {
        if (remainingFrames > 0) {
          requestAnimationFrame(() => finishActivation(remainingFrames - 1))
          return
        }
        anchorActivationPendingRef.current = false
        isAnchoredRef.current = false
        followLiveOutputRef.current = false
        viewportAnchorRef.current = null
        syncBottomStateFromContainer()
        return
      }

      anchorActivationPendingRef.current = false
      isAnchoredRef.current = true
      followLiveOutputRef.current = false
      viewportAnchorRef.current = null
      setAtBottomState(true)

      recalcSpacer()
      animateAnchorIntoPlace()
    }

    // Single rAF lets React commit the DOM from setMessages before we read the turn ref.
    // Avoids anchoring to a stale element that would collapse into an instant jump.
    requestAnimationFrame(() => finishActivation(6))
  }, [animateAnchorIntoPlace, clearBottomScrollFrame, clearBottomSmoothScrollMonitor, promptPinningDisabled, recalcSpacer, scrollToBottom, setAtBottomState, syncBottomStateFromContainer])

  const stickToBottomAfterLayoutScroll = useCallback((container: HTMLDivElement) => {
    programmaticScrollDepthRef.current++
    container.scrollTop = maxScrollTop(container)
    rememberScrollTop(container)
    setAtBottomState(true)
    requestAnimationFrame(() => {
      programmaticScrollDepthRef.current = Math.max(0, programmaticScrollDepthRef.current - 1)
      const freshContainer = scrollContainerRef.current
      if (!freshContainer) return
      rememberScrollTop(freshContainer)
      syncBottomState(freshContainer)
    })
  }, [maxScrollTop, rememberScrollTop, setAtBottomState, syncBottomState])

  // scroll handler
  // anchored 模式下 spacer 常驻、不再有模式切换；用户向上/向下滚动都不改动 spacer 也不重定 anchor 状态。
  // 唯一仍需识别的：脱离 follow-live-output、刷新 isAtBottom、捕获 non-anchored 的 viewport anchor。
  const handleScrollContainerScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const previousScrollTop = lastObservedScrollTopRef.current
    const previousScrollHeight = lastObservedScrollHeightRef.current
    const currentScrollTop = el.scrollTop
    const layoutWidthScroll = isLayoutWidthScroll(el)
    // 必须在 isLayoutWidthScroll 之后调用，前者更新 inline size 缓存；这里更新 scrollHeight 缓存。
    const heightCorrectionScroll = isHeightCorrectionScroll(el, previousScrollTop)
    // 「用户净滚动量」：扣除 scrollHeight 变化（Virtuoso 同帧修正）后用户的真实滚动意图。
    const heightDelta = previousScrollHeight > 0 ? el.scrollHeight - previousScrollHeight : 0
    const netUserScrollDelta = (currentScrollTop - previousScrollTop) - heightDelta

    // ignore programmatic scrolls
    if (programmaticScrollDepthRef.current > 0) {
      rememberScrollTop(el)
      return
    }

    // Virtuoso / 内容根高度增长导致的被动 scrollTop 修正，跳过所有「用户滚动」状态变化。
    if (heightCorrectionScroll) {
      rememberScrollTop(el)
      syncBottomState(el)
      return
    }

    if (layoutWidthScroll) {
      if (isAnchoredRef.current) {
        recalcSpacer()
        scrollToAnchor()
        syncBottomState(el)
        return
      }
      if (shouldStickToBottom()) {
        stickToBottomAfterLayoutScroll(el)
        return
      }
      syncBottomState(el)
      rememberScrollTop(el)
      if (shouldPreserveViewport()) {
        captureViewportAnchor()
      }
      return
    }

    syncBottomState(el)
    rememberScrollTop(el)

    if (anchorActivationPendingRef.current) return

    const userScrolledUp = netUserScrollDelta < -0.5
    if (followLiveOutputRef.current && userScrolledUp) {
      followLiveOutputRef.current = false
      setAtBottomState(false)
    }
    if (!isAtBottomRef.current) {
      followLiveOutputRef.current = false
    }
    if (shouldPreserveViewport()) {
      captureViewportAnchor()
    } else {
      viewportAnchorRef.current = null
    }
    // anchored 模式下不再有任何 scrollTop 操作或模式切换，到此结束。
  }, [syncBottomState, rememberScrollTop, isLayoutWidthScroll, isHeightCorrectionScroll, recalcSpacer, scrollToAnchor, shouldStickToBottom, stickToBottomAfterLayoutScroll, shouldPreserveViewport, captureViewportAnchor, setAtBottomState])

  const stabilizeDocumentPanelScroll = useCallback((trigger?: HTMLElement | null) => {
    const container = scrollContainerRef.current
    if (!container) return

    if (documentPanelScrollFrameRef.current !== null) {
      cancelAnimationFrame(documentPanelScrollFrameRef.current)
      documentPanelScrollFrameRef.current = null
    }

    const anchor = trigger && container.contains(trigger) ? trigger : null
    const anchorTop = anchor
      ? anchor.getBoundingClientRect().top - container.getBoundingClientRect().top
      : null
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const startedAt = performance.now()
    localExpansionActiveUntilRef.current = startedAt + 420
    followLiveOutputRef.current = false

    const step = () => {
      const currentContainer = scrollContainerRef.current
      if (!currentContainer) return

      if (anchor && anchorTop !== null && anchor.isConnected && currentContainer.contains(anchor)) {
        const nextTop = anchor.getBoundingClientRect().top - currentContainer.getBoundingClientRect().top
        currentContainer.scrollTop += nextTop - anchorTop
      } else {
        currentContainer.scrollTop = Math.max(0, currentContainer.scrollHeight - currentContainer.clientHeight - distanceFromBottom)
      }

      syncBottomState(currentContainer)

      if (performance.now() - startedAt < 360) {
        documentPanelScrollFrameRef.current = requestAnimationFrame(step)
        return
      }

      documentPanelScrollFrameRef.current = null
    }

    documentPanelScrollFrameRef.current = requestAnimationFrame(step)
  }, [syncBottomState])

  // history load: activate anchor and scroll to last user message
  // keep liveStreamActive in sync for effects that read it
  useEffect(() => {
    liveStreamActiveRef.current = liveAssistantTurn != null || liveRunUiVisible
  }, [liveAssistantTurn, liveRunUiVisible])

  useEffect(() => {
    if (messagesLoading) {
      wasLoadingRef.current = true
      // reset anchor state from previous thread
      followLiveOutputRef.current = false
      collapseSpacer()
      return
    }
    if (!wasLoadingRef.current) return
    wasLoadingRef.current = false

    const container = scrollContainerRef.current
    const turn = lastUserMsgRef.current
    if (!container || !turn) return

    const viewportH = container.clientHeight
    const turnH = turn.getBoundingClientRect().height

    if (!promptPinningDisabled && turnH > viewportH * 0.5) {
      // long turn: pin user prompt to top with spacer
      isAnchoredRef.current = true
      followLiveOutputRef.current = false
      recalcSpacer()

      programmaticScrollDepthRef.current++
      container.scrollTop = Math.max(0, offsetInContainer(turn) - PROMPT_PIN_TOP_OFFSET)
      rememberScrollTop(container)
      requestAnimationFrame(() => {
        programmaticScrollDepthRef.current--
        rememberScrollTop(container)
      })
      syncBottomState(container)
    } else {
      // short turn: scroll to natural bottom, no spacer
      container.scrollTop = container.scrollHeight - viewportH
      rememberScrollTop(container)
      syncBottomState(container)
    }
  }, [messagesLoading, promptPinningDisabled, recalcSpacer, collapseSpacer, offsetInContainer, rememberScrollTop, syncBottomState])

  useEffect(() => {
    if (!promptPinningDisabled) return
    collapseSpacer()
  }, [collapseSpacer, promptPinningDisabled])

  useLayoutEffect(() => {
    if (messagesLoading) return
    if (shouldPreserveViewport()) {
      preserveViewportAnchor()
    }
  }, [messages, liveAssistantTurn, liveRunUiVisible, messagesLoading, preserveViewportAnchor, shouldPreserveViewport])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    lastContainerInlineSizeRef.current = container.clientWidth
    lastObservedScrollHeightRef.current = container.scrollHeight
    const previous = container.style.overflowAnchor
    container.style.overflowAnchor = 'none'
    return () => {
      container.style.overflowAnchor = previous
    }
  }, [])

  // auto-scroll during streaming when anchored or at bottom
  useEffect(() => {
    const container = scrollContainerRef.current
    if (anchorActivationPendingRef.current || isAnchorAnimating()) return
    if (isAnchoredRef.current) {
      recalcSpacer()
      // 仅在仍贴着 anchor 目标（isAtBottomRef true）或处于 follow-live 时重新对齐。
      // 用户已经手动滑开时不要把视角拉回——这是 spacer-常驻语义的核心。
      if (isAtBottomRef.current || followLiveOutputRef.current) {
        scrollToAnchor()
      }
      if (container) syncBottomState(container)
      return
    }

    if (!shouldStickToBottom()) {
      if (shouldPreserveViewport()) {
        preserveViewportAnchor()
      }
      return
    }
    const forceInstant = forceInstantBottomScrollRef.current
    if (isBottomSmoothScrolling() && !forceInstant) {
      setAtBottomState(true)
      return
    }
    const liveHandoffPaint =
      liveAssistantTurn != null && liveAssistantTurn.segments.length > 0
    const behavior: ScrollBehavior = forceInstant || liveRunUiVisible || liveHandoffPaint ? 'instant' : 'smooth'
    const bottom = bottomRef.current
    if (container && bottom) {
      const bottomTop = bottom.offsetTop
      const viewBottom = container.scrollTop + container.clientHeight
      if (bottomTop > viewBottom) {
        scrollViewportToBottom(behavior)
      }
    } else {
      bottomRef.current?.scrollIntoView({ behavior })
    }
    if (forceInstant) forceInstantBottomScrollRef.current = false
    if (shouldPreserveViewport()) {
      captureViewportAnchor()
    }
  }, [messages, liveAssistantTurn, liveRunUiVisible, preserveViewportAnchor, recalcSpacer, scrollToAnchor, scrollViewportToBottom, shouldPreserveViewport, captureViewportAnchor, shouldStickToBottom, isAnchorAnimating, isBottomSmoothScrolling, setAtBottomState])

  // ResizeObserver on anchor turn: recalc spacer when turn content changes size
  useEffect(() => {
    const turn = lastUserMsgRef.current
    if (!turn || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      if (!entries.some(hasResizeObserverBlockChange)) return
      if (anchorActivationPendingRef.current || isAnchorAnimating()) return
      if (isAnchoredRef.current) {
        recalcSpacer()
        // 流式期间长 turn 增高时跟随到底部展示最新输出。
        if (followLiveOutputRef.current) {
          scrollToAnchor()
        } else if (shouldPreserveViewport()) {
          // 用户已经手动滑过 anchor 区，lastTurn 内部还在增长（如 assistant 流式输出推走了阅读位置）：
          // 通过 viewport anchor 保护当前阅读位置不被推走。
          preserveViewportAnchor()
        }
        const container = scrollContainerRef.current
        if (container) syncBottomState(container)
        return
      }

      if (isLocalExpansionActive()) return
      if (shouldStickToBottom()) {
        if (isBottomSmoothScrolling()) return
        scrollViewportToBottom('instant')
        return
      }
      if (shouldPreserveViewport()) {
        preserveViewportAnchor()
      }
    })
    ro.observe(turn)
    return () => ro.disconnect()
  }, [messages, liveAssistantTurn, preserveViewportAnchor, recalcSpacer, scrollToAnchor, scrollViewportToBottom, shouldPreserveViewport, syncBottomState, isLocalExpansionActive, shouldStickToBottom, isAnchorAnimating, isBottomSmoothScrolling])

  useEffect(() => {
    const root = contentRoot()
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      if (!entries.some(hasResizeObserverBlockChange)) return
      if (anchorActivationPendingRef.current || isAnchorAnimating()) return
      if (isAnchoredRef.current) {
        // anchored 模式下 spacer 常驻、不再主动调 scrollTop。
        // contentRoot 高度变化主要来自虚拟化历史区的 item 测量，由 Virtuoso 的 scrollHeight 修正机制
        // 自身保持视角稳定（参见 isHeightCorrectionScroll）。这里只更新 spacer 与 bottom state。
        recalcSpacer()
        const container = scrollContainerRef.current
        if (container) syncBottomState(container)
        return
      }

      if (isLocalExpansionActive()) return
      if (shouldStickToBottom()) {
        if (isBottomSmoothScrolling()) return
        scrollViewportToBottom('instant')
        return
      }
      if (shouldPreserveViewport()) {
        preserveViewportAnchor()
      }
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [contentRoot, preserveViewportAnchor, recalcSpacer, scrollViewportToBottom, shouldPreserveViewport, syncBottomState, isLocalExpansionActive, shouldStickToBottom, isAnchorAnimating, isBottomSmoothScrolling])

  useEffect(() => {
    const el = copCodeExecScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [topLevelCodeExecutionsLength, liveAssistantTurn])

  // input area resize observer
  useEffect(() => {
    const el = inputAreaRef.current
    if (!el) return
    const syncInputAreaHeight = () => {
      document.documentElement.style.setProperty('--chat-input-area-height', `${Math.ceil(inputAreaHeight())}px`)
    }
    if (typeof ResizeObserver === 'undefined') {
      syncInputAreaHeight()
      return
    }
    syncInputAreaHeight()
    const ro = new ResizeObserver(() => {
      syncInputAreaHeight()
      if (anchorActivationPendingRef.current || isAnchorAnimating()) return
      if (isAnchoredRef.current) {
        recalcSpacer()
        if (isAtBottomRef.current || followLiveOutputRef.current) {
          scrollToAnchor()
        }
        syncBottomStateFromContainer()
        return
      }

      if (shouldStickToBottom()) {
        if (isBottomSmoothScrolling()) return
        scrollViewportToBottom('instant')
        return
      }
      if (shouldPreserveViewport()) {
        preserveViewportAnchor()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [inputAreaHeight, preserveViewportAnchor, recalcSpacer, scrollToAnchor, scrollViewportToBottom, shouldPreserveViewport, syncBottomStateFromContainer, shouldStickToBottom, isAnchorAnimating, isBottomSmoothScrolling])

  // window resize: recalc spacer
  useEffect(() => {
    const handler = () => {
      if (anchorActivationPendingRef.current || isAnchorAnimating()) return
      if (isAnchoredRef.current) {
        recalcSpacer()
        if (isAtBottomRef.current || followLiveOutputRef.current) {
          scrollToAnchor()
        }
        syncBottomStateFromContainer()
        return
      }

      if (shouldStickToBottom()) {
        if (isBottomSmoothScrolling()) return
        scrollViewportToBottom('instant')
        return
      }
      if (shouldPreserveViewport()) {
        preserveViewportAnchor()
      }
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [preserveViewportAnchor, recalcSpacer, scrollToAnchor, scrollViewportToBottom, shouldPreserveViewport, syncBottomStateFromContainer, shouldStickToBottom, isAnchorAnimating, isBottomSmoothScrolling])

  // cleanup animation frames on unmount
  useEffect(() => {
    return () => {
      clearAnchorScrollMonitor()
      clearAnchorScrollSettleGuard()
      clearBottomScrollFrame()
      clearBottomSmoothScrollMonitor()
      if (documentPanelScrollFrameRef.current !== null) {
        cancelAnimationFrame(documentPanelScrollFrameRef.current)
      }
      anchorActivationPendingRef.current = false
    }
  }, [clearAnchorScrollMonitor, clearAnchorScrollSettleGuard, clearBottomScrollFrame, clearBottomSmoothScrollMonitor])

  return {
    bottomRef,
    scrollContainerRef,
    lastUserMsgRef,
    lastUserPromptRef,
    inputAreaRef,
    copCodeExecScrollRef,
    spacerRef,
    forceInstantBottomScrollRef,
    wasLoadingRef,
    documentPanelScrollFrameRef,
    isAtBottomRef,
    programmaticScrollDepthRef,
    handleScrollContainerScroll,
    captureViewportAnchor,
    scrollToBottom,
    activateAnchor,
    syncBottomState,
    stabilizeDocumentPanelScroll,
    subscribeIsAtBottom,
    getIsAtBottomSnapshot,
  }
}
