import { normalizeRelativeURLs } from "../../util/path"
import { fetchCanonical } from "./util"

// Sliding Panes Router Implementation

// Cleanup system for event listeners (required by all Quartz components)
const cleanupFns: Set<(...args: any[]) => void> = new Set()
window.addCleanup = (fn) => cleanupFns.add(fn)

const CONTAINER_SELECTOR = ".center"
const PANE_SELECTOR = ".sliding-pane"
const PANE_WIDTH = 40 // px, width of the spine
const MOBILE_BREAKPOINT = 800

function getContainer() {
  return document.querySelector(CONTAINER_SELECTOR)
}

function getPanes() {
  const container = getContainer()
  return container ? Array.from(container.querySelectorAll(PANE_SELECTOR)) : []
}

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT
}

// Custom horizontal-only scroll function to avoid vertical displacement from scrollIntoView
function scrollPaneIntoView(pane: Element, behavior: ScrollBehavior = "smooth") {
  const container = getContainer() as HTMLElement
  if (!container || !pane) return

  const containerRect = container.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()

  // Calculate where we need to scroll to center the pane horizontally
  const paneCenter = paneRect.left + paneRect.width / 2
  const containerCenter = containerRect.left + containerRect.width / 2
  const scrollOffset = paneCenter - containerCenter

  container.scrollBy({
    left: scrollOffset,
    top: 0, // Explicitly no vertical scrolling
    behavior: behavior
  })
}

function updatePanePositions() {
  const panes = getPanes()
  panes.forEach((pane, index) => {
    const p = pane as HTMLElement
    // Set sticky left position
    p.style.left = `${index * PANE_WIDTH}px`
    // Ensure z-index is correct so later panes slide over earlier ones
    p.style.zIndex = `${5 + index}`
  })

  // Check obscured state immediately after position update
  checkObscured()
}

function createSpine(doc: Document | HTMLElement, title?: string) {
  const spine = document.createElement("div")
  spine.className = "sliding-pane-spine"
  spine.innerText = title || doc.querySelector("h1")?.innerText || "Untitled"
  spine.onclick = (e) => {
    e.stopPropagation()
    const pane = (e.target as HTMLElement).closest(PANE_SELECTOR)
    if (pane) scrollPaneIntoView(pane)
  }
  return spine
}

function checkObscured() {
  const container = getContainer() as HTMLElement
  if (!container) return

  const panes = getPanes()

  panes.forEach((pane, index) => {
    const p = pane as HTMLElement
    const rect = p.getBoundingClientRect()

    let isObscured = false
    if (index < panes.length - 1) {
      const nextPane = panes[index + 1] as HTMLElement
      const nextRect = nextPane.getBoundingClientRect()

      const visibleWidth = nextRect.left - rect.left

      if (visibleWidth < 150) {
        isObscured = true
      }
    }

    if (isObscured) {
      p.classList.add("obscured")
    } else {
      p.classList.remove("obscured")
    }
  })
}

// Helper to determine if a URL is local and should be handled
// Copied from original spa.inline.ts
const isLocalUrl = (href: string) => {
  try {
    const url = new URL(href)
    if (window.location.origin === url.origin) {
      return true
    }
  } catch (e) { }
  return false
}

// Update the URL to reflect current stack
function updateUrlState() {
  const panes = getPanes()
  if (panes.length === 0) return

  // Store stacked slugs in URL
  const stackedSlugs = panes.slice(1).map(p => (p as HTMLElement).dataset.slug).filter(Boolean)
  const url = new URL(window.location.href)

  if (stackedSlugs.length > 0) {
    url.searchParams.set("stacked", stackedSlugs.join(","))
  } else {
    url.searchParams.delete("stacked")
  }

  history.pushState({}, "", url.toString())
}

async function appendPane(url: URL, scroll: boolean = true, replaceFromIndex?: number) {
  const container = getContainer()
  if (!container) return

  let panes = getPanes()

  // Prune panes if replaceFromIndex is provided
  if (replaceFromIndex !== undefined && replaceFromIndex >= 0 && replaceFromIndex < panes.length) {
    const panesToRemove = panes.slice(replaceFromIndex + 1)
    panesToRemove.forEach(p => p.remove())
    panes = getPanes()
  }

  // Optimistic check using URL
  const existing = panes.find(p => (p as HTMLElement).dataset.url === url.href)
  if (existing) {
    if (scroll) scrollPaneIntoView(existing)
    return
  }

  // Fetch content
  try {
    const res = await fetchCanonical(url)
    if (!res.ok) throw new Error("Failed to load")

    const text = await res.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, "text/html")
    normalizeRelativeURLs(doc, url)

    const newContent = doc.querySelector(PANE_SELECTOR)
    if (!newContent) {
      console.warn("No sliding pane content found in response")
      window.location.assign(url)
      return
    }

    const newPane = newContent.cloneNode(true) as HTMLElement

    // Set metadata on pane
    const pageSlug = doc.body.dataset.slug
    newPane.dataset.slug = pageSlug
    newPane.dataset.url = url.href

    // Check for duplicates by slug after fetch (authoritative)
    const existingBySlug = panes.find(p => (p as HTMLElement).dataset.slug === pageSlug)
    if (existingBySlug) {
      if (scroll) scrollPaneIntoView(existingBySlug)
      return
    }

    // Add spine - PREPEND so it comes before content in Flex
    const title = doc.title || doc.querySelector("h1")?.innerText
    const spine = createSpine(doc, title)
    newPane.prepend(spine)

    container.appendChild(newPane)
    updatePanePositions() // Update sticky offsets

    const event = new CustomEvent("nav", { detail: { url: pageSlug } })
    document.dispatchEvent(event)

    if (scroll) {
      scrollPaneIntoView(newPane)
    }

    updateUrlState()

  } catch (e) {
    console.error(e)
    window.location.assign(url)
  }
}

// Initialize
function init() {
  if (typeof window === "undefined") return

  // Set initial pane attributes
  const container = getContainer()
  const initialPane = container?.querySelector(PANE_SELECTOR) as HTMLElement
  if (initialPane) {
    initialPane.dataset.slug = document.body.dataset.slug
    initialPane.dataset.url = window.location.href

    const spine = createSpine(document)
    initialPane.prepend(spine) // Prepended here too

    updatePanePositions()

    const event = new CustomEvent("nav", { detail: { url: document.body.dataset.slug } })
    document.dispatchEvent(event)
  }

  // Load stacked panes from URL (desktop only)
  if (!isMobile()) {
    const params = new URLSearchParams(window.location.search)
    const stacked = params.get("stacked")
    if (stacked) {
      const slugs = stacked.split(",")
      const loadStacked = async () => {
        for (const slug of slugs) {
          const url = new URL(slug, window.location.origin)
          await appendPane(url, false)
        }
        const panes = getPanes()
        if (panes.length > 0) {
          scrollPaneIntoView(panes[panes.length - 1], "instant")
        }
      }
      loadStacked()
    }
  }

  // Scroll Listener for Obscured State
  const containerEl = getContainer()
  if (containerEl) {
    containerEl.addEventListener("scroll", () => {
      checkObscured()
    }, { passive: true })
    window.addEventListener("resize", () => {
      checkObscured()
    }, { passive: true })
  }

  // Event Listeners
  window.addEventListener("click", async (event) => {
    const target = event.target as Element
    const a = target.closest("a")
    if (!a) return

    // Ignore if special keys, target blank, or non-internal
    if (event.ctrlKey || event.metaKey || a.target === "_blank") return
    if (!isLocalUrl(a.href)) return
    if ("routerIgnore" in a.dataset) return

    const url = new URL(a.href)

    if (url.pathname === window.location.pathname && url.hash) {
      return // Let browser handle hash
    }

    if (url.href === window.location.href) {
      event.preventDefault()
      return
    }

    event.preventDefault()

    // On mobile, use traditional navigation (no stacking)
    if (isMobile()) {
      window.location.assign(url)
      return
    }

    // Find which pane this click came from
    const sourcePane = a.closest(PANE_SELECTOR)
    let replaceIndex = undefined
    if (sourcePane) {
      const panes = getPanes()
      replaceIndex = panes.indexOf(sourcePane as Element)
    }

    await appendPane(url, true, replaceIndex)
  })

  // Popstate
  window.addEventListener("popstate", () => {
    window.location.reload()
  })

  // Expose for debugging
  window.spaNavigate = (url) => appendPane(url instanceof URL ? url : new URL(url, window.location.origin))

  // Initial check
  checkObscured()
}

init()
