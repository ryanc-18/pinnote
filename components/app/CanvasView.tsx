'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Eye, EyeOff } from 'lucide-react'
import { PillMarker } from '@/components/ui/annotationMarker'
import AnnotationPanel, { type AnnotationPanelHandle } from './AnnotationPanel'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Annotation } from '@/types'
import {
  getAnnotations,
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
} from '@/lib/api'

const BASE_RENDER_SCALE = 2
const PAGE_GAP = 16

type PageDimension = { width: number; height: number }

export default function CanvasView({
  pdfUrl,
  noteId,
}: {
  pdfUrl: string
  noteId: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const pdfRef = useRef<PDFDocumentProxy | null>(null)

  const [pageDims, setPageDims] = useState<PageDimension[]>([])
  const [zoom, setZoom] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const annotationsRef = useRef<Annotation[]>([])
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(
    null
  )
  const undoStackRef = useRef<Annotation[]>([])
  const panelRef = useRef<AnnotationPanelHandle>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [contentLoadKey, setContentLoadKey] = useState(0)
  const [panelMode, setPanelMode] = useState<'single' | 'all'>('single')
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(
    null
  )
  const [markersVisible, setMarkersVisible] = useState(false)
  const [markerOpacity, setMarkerOpacity] = useState(0.8)

  // ── Step 1: load PDF and collect page dimensions ───────────────────────────
  // Does NOT render yet — just gets dims so React can mount the canvases
  useEffect(() => {
    let cancelled = false

    async function loadPdf() {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        // Worker served from public/ — avoids import.meta.url issues in Turbopack
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        const pdf = await pdfjsLib.getDocument(pdfUrl).promise
        if (cancelled) return

        pdfRef.current = pdf

        const dims: PageDimension[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: BASE_RENDER_SCALE })
          dims.push({ width: vp.width, height: vp.height })
        }

        if (!cancelled) setPageDims(dims)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }

    loadPdf()
    return () => {
      cancelled = true
    }
  }, [pdfUrl])

  // ── Step 2: render pages onto canvases once they are mounted ───────────────
  // pageDims changing means canvases are now in the DOM
  useEffect(() => {
    if (pageDims.length === 0 || !pdfRef.current) return
    let cancelled = false

    async function renderPages() {
      const pdf = pdfRef.current!
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return
        const canvas = canvasRefs.current[i - 1]
        if (!canvas) continue

        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: BASE_RENDER_SCALE })

        canvas.width = vp.width
        canvas.height = vp.height

        await page.render({
          canvasContext: canvas.getContext('2d')!,
          canvas,
          viewport: vp,
        }).promise
      }

      if (!cancelled) setLoading(false)
    }

    renderPages()
    return () => {
      cancelled = true
    }
  }, [pageDims])

  // ── Set initial zoom to fit first page width in viewport ─────────────────
  useEffect(() => {
    if (pageDims.length === 0) return

    function computeInitial() {
      const container = containerRef.current
      if (!container) return
      const firstPageW = pageDims[0].width / BASE_RENDER_SCALE
      const firstPageH = pageDims[0].height / BASE_RENDER_SCALE
      const fitWidth = (container.clientWidth - 80) / firstPageW
      const fitHeight = (container.clientHeight - 64) / firstPageH
      const fitPage = Math.min(fitWidth, fitHeight)
      setZoom((prev) => (prev === null ? fitPage : prev))
    }

    computeInitial()
    const ro = new ResizeObserver(computeInitial)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [pageDims])

  // Reset state and load annotations from DB when switching documents
  useEffect(() => {
    setAnnotations([])
    annotationsRef.current = []
    setActiveAnnotationId(null)
    undoStackRef.current = []

    async function loadAnnotations() {
      const data = await getAnnotations(noteId)
      setAnnotations(data)
      annotationsRef.current = data
    }
    loadAnnotations()
  }, [pdfUrl, noteId])

  // ── Delete an annotation by id ────────────────────────────────────────────
  const performDelete = useCallback((id: string) => {
    const deleted = annotationsRef.current.find((a) => a.id === id)
    if (deleted) undoStackRef.current = [...undoStackRef.current, deleted]
    const next = annotationsRef.current.filter((a) => a.id !== id)
    annotationsRef.current = next
    setAnnotations(next)
    setActiveAnnotationId(null)
    setConfirmDeleteId(null)
    deleteAnnotation(id)
  }, [])

  // Keep annotationsRef in sync so keyboard handler can read current value without stale closures
  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  // ── Keyboard: Backspace to delete active annotation, Cmd/Ctrl+Z to undo ───
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (panelMode === 'all') {
          setPanelMode('single')
          return
        }
        if (activeAnnotationId) {
          setActiveAnnotationId(null)
          return
        }
      }

      const target = e.target instanceof Element ? e.target : null
      const isTyping =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        (target as HTMLElement)?.isContentEditable
      if (e.key === 'Backspace' && activeAnnotationId && !isTyping) {
        const annotation = annotationsRef.current.find(
          (a) => a.id === activeAnnotationId
        )
        if (annotation?.text.trim()) {
          setConfirmDeleteId(activeAnnotationId)
        } else {
          performDelete(activeAnnotationId)
        }
      }

      if (
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        activeAnnotationId &&
        !isTyping
      ) {
        panelRef.current?.focusTextarea()
        return
      }

      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (undoStackRef.current.length === 0) return
        const restored = undoStackRef.current[undoStackRef.current.length - 1]
        undoStackRef.current = undoStackRef.current.slice(0, -1)
        const next = [...annotationsRef.current, restored]
        annotationsRef.current = next
        setAnnotations(next)
        setContentLoadKey((k) => k + 1)
        setActiveAnnotationId(restored.id)
        createAnnotation(noteId, {
          page: restored.page,
          x: restored.x,
          y: restored.y,
          number: restored.number,
          text: restored.text,
        }).then((saved) => {
          const updated = annotationsRef.current.map((a) =>
            a.id === restored.id ? { ...a, id: saved.id } : a
          )
          annotationsRef.current = updated
          setAnnotations(updated)
          setActiveAnnotationId(saved.id)
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeAnnotationId, panelMode])

  // ── Zoom via scroll wheel ──────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    // ctrlKey is true for pinch gestures on trackpads — use those for zoom.
    // Regular scroll events (ctrlKey false) are left alone so the page scrolls normally.
    if (!e.ctrlKey) return
    e.preventDefault()
    const SPEED = 0.005
    setZoom((prev) => {
      if (prev === null) return prev
      return Math.min(3, Math.max(0.1, prev - e.deltaY * SPEED))
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Double click: place a new annotation ──────────────────────────────────
  const handlePageDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageIndex: number) => {
      // store marker spawn position as percentage relative to the page
      // ...to accomodate zoom
      const rect = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      const newAnnotation: Annotation = {
        id: `annotation-${Date.now()}`,
        page: pageIndex,
        x,
        y,
        number: annotationsRef.current.length + 1,
        text: '',
      }
      const next = [...annotationsRef.current, newAnnotation]
      annotationsRef.current = next
      setAnnotations(next)
      setContentLoadKey((k) => k + 1)
      setActiveAnnotationId(newAnnotation.id)

      // Save to DB and swap temp id for the real one
      createAnnotation(noteId, {
        page: pageIndex,
        x,
        y,
        number: newAnnotation.number,
        text: '',
      }).then((saved) => {
        const updated = annotationsRef.current.map((a) =>
          a.id === newAnnotation.id ? { ...a, id: saved.id } : a
        )
        annotationsRef.current = updated
        setAnnotations(updated)
        setActiveAnnotationId(saved.id)
        // Flush any text typed during the temp-ID window
        const flushed = updated.find((a) => a.id === saved.id)
        if (flushed?.text) updateAnnotation(saved.id, flushed.text)
      })
    },
    []
  )

  // ── Update annotation text ─────────────────────────────────────────────────
  const handleAnnotationTextChange = useCallback((id: string, text: string) => {
    const next = annotationsRef.current.map((a) =>
      a.id === id ? { ...a, text } : a
    )
    annotationsRef.current = next
    setAnnotations(next)
    // Skip DB update while annotation still has a temp id (real id arrives via createAnnotation)
    if (!id.startsWith('annotation-')) updateAnnotation(id, text)
  }, [])

  // ── Derived values ─────────────────────────────────────────────────────────
  const effectiveZoom = zoom ?? 1
  const naturalPages = pageDims.map((d) => ({
    width: d.width / BASE_RENDER_SCALE,
    height: d.height / BASE_RENDER_SCALE,
  }))
  const scaledPageWidth = (naturalPages[0]?.width ?? 0) * effectiveZoom
  const scaledTotalHeight =
    naturalPages.reduce((sum, p) => sum + p.height * effectiveZoom, 0) +
    PAGE_GAP * (pageDims.length - 1) * effectiveZoom
  const containerH = containerRef.current?.clientHeight ?? 0
  const fitsVertically = scaledTotalHeight <= containerH

  const confirmAnnotation =
    annotations.find((a) => a.id === confirmDeleteId) ?? null

  const activeAnnotation =
    annotations.find((a) => a.id === activeAnnotationId) ?? null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex overflow-hidden">
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        style={{
          background: 'var(--paper-surface)',
          overscrollBehavior: 'none',
        }}
      >
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="text-[13px] text-[var(--text-muted)]"
              style={{ fontFamily: 'var(--font-ui)' }}
            >
              Loading document…
            </span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="text-[13px] text-red-400"
              style={{ fontFamily: 'var(--font-ui)' }}
            >
              Failed to load document.
            </span>
          </div>
        )}

        {/* Zoom indicator + marker toggle — always visible once dims are known */}
        {pageDims.length > 0 && (
          <div className="fixed bottom-5 right-6 z-50 flex items-center gap-2">
            {/* Toggle button + vibrancy slider, grouped so popup is positioned relative to the button */}
            <div style={{ position: 'relative' }}>
              {/* Vibrancy slider — animates up above the toggle button when markers are on */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: '50%',
                  transform: `translateX(-50%) translateY(${markersVisible ? '0px' : '6px'})`,
                  opacity: markersVisible ? 1 : 0,
                  pointerEvents: markersVisible ? 'auto' : 'none',
                  transition: 'opacity 0.2s ease, transform 0.2s ease',
                  background: 'rgba(14,14,20,0.88)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <input
                  type="range"
                  min={20}
                  max={100}
                  value={Math.round(markerOpacity * 100)}
                  onChange={(e) =>
                    setMarkerOpacity(Number(e.target.value) / 100)
                  }
                  style={{
                    width: '110px',
                    accentColor: '#5578F0',
                    cursor: 'pointer',
                    display: 'block',
                  }}
                />
              </div>

              <button
                onClick={() => setMarkersVisible((v) => !v)}
                title={markersVisible ? 'Hide markers' : 'Show markers'}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors duration-150"
                style={{
                  background: markersVisible
                    ? 'rgba(45,62,158,0.15)'
                    : 'rgba(0,0,0,0.06)',
                  color: markersVisible ? '#6b82e8' : 'var(--text-muted)',
                  border: markersVisible
                    ? '1px solid rgba(45,62,158,0.35)'
                    : '1px solid var(--border)',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                {markersVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                <span>{markersVisible ? 'Markers on' : 'Markers off'}</span>
              </button>
            </div>

            <div
              className="text-[11px] tabular-nums px-2.5 py-1 rounded-md"
              style={{
                background: 'rgba(0,0,0,0.06)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                border: '1px solid var(--border)',
              }}
            >
              {Math.round(effectiveZoom * 100)}%
            </div>
          </div>
        )}

        {/* Tips bubble — visible until the first annotation is placed */}
        {pageDims.length > 0 && !loading && (
          <div
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{
              background: 'rgba(20,20,30,0.82)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontFamily: 'var(--font-ui)',
              opacity: annotations.length === 0 ? 1 : 0,
              pointerEvents: 'none',
              transition: 'opacity 0.4s ease',
            }}
          >
            <svg
              width="12"
              height="14"
              viewBox="0 0 12 14"
              fill="none"
              style={{ flexShrink: 0, color: 'rgba(255,255,255,0.6)' }}
            >
              <path
                d="M1 1L1 10L3.5 7.5L5 11.5L6.5 10.5L5 6.5H8.5L1 1Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span
              className="text-[11px]"
              style={{ color: 'rgba(255,255,255,0.7)' }}
            >
              Double-click anywhere on the document to place a marker
            </span>
          </div>
        )}

        {/* Page layout — rendered immediately once dims are known so canvases mount */}
        {pageDims.length > 0 && (
          <div
            style={{
              minHeight: '100%',
              minWidth: '100%',
              display: 'flex',
              alignItems: fitsVertically ? 'center' : 'flex-start',
              padding: fitsVertically ? '0 40px' : '32px 40px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: `${PAGE_GAP * effectiveZoom}px`,
                width: `${scaledPageWidth}px`,
                margin: '0 auto',
              }}
            >
              {naturalPages.map((page, i) => (
                <div
                  key={i}
                  onDoubleClick={(e) => handlePageDoubleClick(e, i)}
                  style={{
                    width: `${Math.round(page.width * effectiveZoom)}px`,
                    height: `${Math.round(page.height * effectiveZoom)}px`,
                    flexShrink: 0,
                    boxShadow:
                      '0 1px 2px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    position: 'relative',
                    cursor: 'default',
                  }}
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[i] = el
                    }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      display: 'block',
                    }}
                  />

                  {/* Annotation markers for this page */}
                  {annotations
                    .filter((a) => a.page === i)
                    .map((a) => (
                      <div
                        key={a.id}
                        style={{
                          position: 'absolute',
                          left: `${a.x}%`,
                          top: `${a.y}%`,
                          transform: `translate(-50%, -50%) ${panelMode === 'all' && hoveredAnnotationId === a.id ? 'scale(1.25)' : 'scale(1)'}`,
                          zIndex:
                            panelMode === 'all' && hoveredAnnotationId === a.id
                              ? 20
                              : 10,
                          opacity:
                            panelMode === 'all' &&
                            hoveredAnnotationId !== null &&
                            hoveredAnnotationId !== a.id
                              ? 0.3
                              : 1,
                          transition:
                            'opacity 0.15s ease, transform 0.15s ease',
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={() => {
                          if (panelMode === 'all') setHoveredAnnotationId(a.id)
                        }}
                        onMouseLeave={() => {
                          if (panelMode === 'all') setHoveredAnnotationId(null)
                        }}
                      >
                        <PillMarker
                          number={a.number}
                          isActive={
                            panelMode === 'all' || activeAnnotationId === a.id
                          }
                          isFilled={
                            markersVisible &&
                            activeAnnotationId !== a.id &&
                            panelMode !== 'all'
                          }
                          filledOpacity={markerOpacity}
                          isSpawning={activeAnnotationId === a.id}
                          onClick={() => {
                            if (panelMode === 'all') {
                              setPanelMode('single')
                              setContentLoadKey((k) => k + 1)
                              setActiveAnnotationId(a.id)
                              return
                            }
                            if (activeAnnotationId !== a.id)
                              setContentLoadKey((k) => k + 1)
                            setActiveAnnotationId((prev) =>
                              prev === a.id ? null : a.id
                            )
                          }}
                        />
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AnnotationPanel
        ref={panelRef}
        isOpen={activeAnnotation !== null || panelMode === 'all'}
        annotation={activeAnnotation}
        annotations={annotations}
        panelMode={panelMode}
        onPanelModeChange={setPanelMode}
        contentLoadKey={contentLoadKey}
        onTextChange={handleAnnotationTextChange}
        onHoverAnnotation={setHoveredAnnotationId}
        hoveredAnnotationId={hoveredAnnotationId}
        onSelectAnnotation={(a) => {
          setPanelMode('single')
          setActiveAnnotationId(a.id)
          setContentLoadKey((k) => k + 1)
          canvasRefs.current[a.page]?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        }}
        onClose={() => {
          setActiveAnnotationId(null)
          setPanelMode('single')
        }}
      />
      {confirmAnnotation && (
        <ConfirmDialog
          message={`Delete annotation ${confirmAnnotation.number} and its note?`}
          onConfirm={() => performDelete(confirmAnnotation.id)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}
