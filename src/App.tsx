import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import './App.css'

type Tool = 'pen' | 'text' | 'table' | 'move' | 'resize' | 'eraser'
type Theme = 'light' | 'dark'

type Point = { x: number; y: number }

type BaseShape = {
  id: string
  createdBy: string
  createdAt: number
}

type PathShape = BaseShape & {
  type: 'path'
  points: Point[]
  stroke: string
  strokeWidth: number
}

type TextShape = BaseShape & {
  type: 'text'
  x: number
  y: number
  text: string
  color: string
  fontSize: number
}

type TableShape = BaseShape & {
  type: 'table'
  x: number
  y: number
  rows: number
  cols: number
  cellWidth: number
  cellHeight: number
  stroke: string
  cells: string[][]
}

type Shape = PathShape | TextShape | TableShape

type HistoryItem = {
  id: string
  timestamp: number
  user: string
  description: string
}

type ChannelMessage =
  | {
      kind: 'add-shape'
      shape: Shape
      history: HistoryItem
      senderId: string
    }
  | { kind: 'clear-board'; history: HistoryItem; senderId: string }
  | { kind: 'sync-request'; senderId: string }
  | {
      kind: 'sync-state'
      shapes: Shape[]
      history: HistoryItem[]
      senderId: string
    }
  | {
      kind: 'update-shape'
      shape: Shape
      history: HistoryItem
      senderId: string
    }
  | {
      kind: 'delete-shape'
      shapeId: string
      history: HistoryItem
      senderId: string
    }
  | {
      kind: 'undo-redo'
      shapes: Shape[]
      history: HistoryItem[]
      senderId: string
    }

const STORAGE_KEYS = {
  shapes: 'dashboard.whiteboard.shapes',
  history: 'dashboard.whiteboard.history',
  user: 'dashboard.whiteboard.user',
  theme: 'dashboard.whiteboard.theme',
} as const

const randomId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11)

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const DEFAULT_FONT_SIZE = 18
const MIN_TEXT_SIZE = 10
const MAX_TEXT_SIZE = 120
const MIN_TABLE_CELL = 20
const MIN_RESIZE_DIMENSION = 16
const MIN_PATH_DIMENSION = 4
const ERASER_RADIUS = 18

type ShapeBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

const getShapeBounds = (shape: Shape): ShapeBounds => {
  switch (shape.type) {
    case 'text': {
      const charWidth = shape.fontSize * 0.6
      const width = Math.max(charWidth * Math.max(shape.text.length, 1), shape.fontSize)
      const height = shape.fontSize * 1.4
      return {
        minX: shape.x,
        minY: shape.y - height,
        maxX: shape.x + width,
        maxY: shape.y,
        width,
        height,
      }
    }
    case 'table': {
      const width = shape.cols * shape.cellWidth
      const height = shape.rows * shape.cellHeight
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + width,
        maxY: shape.y + height,
        width,
        height,
      }
    }
    case 'path': {
      if (!shape.points.length) {
        return {
          minX: shape.points[0]?.x ?? 0,
          minY: shape.points[0]?.y ?? 0,
          maxX: shape.points[0]?.x ?? 0,
          maxY: shape.points[0]?.y ?? 0,
          width: MIN_PATH_DIMENSION,
          height: MIN_PATH_DIMENSION,
        }
      }
      const xs = shape.points.map((point) => point.x)
      const ys = shape.points.map((point) => point.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(maxX - minX, MIN_PATH_DIMENSION),
        height: Math.max(maxY - minY, MIN_PATH_DIMENSION),
      }
    }
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: MIN_RESIZE_DIMENSION, height: MIN_RESIZE_DIMENSION }
  }
}

const getTimestamp = () => Date.now()

const getPreferredTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark'
  const storedTheme = loadFromStorage<Theme | null>(STORAGE_KEYS.theme, null)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
  return prefersLight ? 'light' : 'dark'
}

const loadFromStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch (error) {
    console.warn(`Failed to read ${key} from storage`, error)
    return fallback
  }
}

const saveToStorage = <T,>(key: string, value: T) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Failed to save ${key} in storage`, error)
  }
}

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)

const ensureTableCells = (shape: TableShape): TableShape => {
  const legacyCells = (shape as TableShape & { cells?: string[][] }).cells
  const cells = Array.from({ length: shape.rows }, (_, rowIndex) => {
    const existingRow = legacyCells?.[rowIndex] ?? []
    return Array.from({ length: shape.cols }, (_, colIndex) => existingRow[colIndex] ?? '')
  })
  return { ...shape, cells }
}

const normalizeShape = (shape: Shape): Shape => {
  if (shape.type === 'table') {
    return ensureTableCells(shape)
  }
  if (shape.type === 'text') {
    return {
      ...shape,
      fontSize:
        typeof shape.fontSize === 'number' && Number.isFinite(shape.fontSize)
          ? shape.fontSize
          : DEFAULT_FONT_SIZE,
    }
  }
  return shape
}

const normalizeShapes = (shapes: Shape[]) => shapes.map(normalizeShape)

const cloneShape = (shape: Shape): Shape => {
  switch (shape.type) {
    case 'path':
      return { ...shape, points: shape.points.map((point) => ({ ...point })) }
    case 'table':
      return { ...shape }
    case 'text':
      return { ...shape }
    default:
      return shape
  }
}

const distanceSquared = (a: Point, b: Point) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

const isPointNearSegment = (point: Point, segmentStart: Point, segmentEnd: Point, threshold: number) => {
  const lengthSquared = distanceSquared(segmentStart, segmentEnd)
  if (lengthSquared === 0) {
    return distanceSquared(point, segmentStart) <= threshold * threshold
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * (segmentEnd.x - segmentStart.x) +
        (point.y - segmentStart.y) * (segmentEnd.y - segmentStart.y)) /
        lengthSquared,
    ),
  )
  const projection = {
    x: segmentStart.x + t * (segmentEnd.x - segmentStart.x),
    y: segmentStart.y + t * (segmentEnd.y - segmentStart.y),
  }
  return distanceSquared(point, projection) <= threshold * threshold
}

const isPointInsideBounds = (point: Point, bounds: ShapeBounds) =>
  point.x >= bounds.minX &&
  point.x <= bounds.maxX &&
  point.y >= bounds.minY &&
  point.y <= bounds.maxY

function App() {
  const clientId = useMemo(() => randomId(), [])

  const [theme, setTheme] = useState<Theme>(() => getPreferredTheme())
  const [userName, setUserName] = useState(() => {
    const stored = loadFromStorage(STORAGE_KEYS.user, '')
    if (stored) return stored
    return `Guest-${Math.floor(Math.random() * 900 + 100)}`
  })

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#22d3ee')
  const [strokeWidth, setStrokeWidth] = useState(4)

  const [shapes, setShapes] = useState<Shape[]>(() =>
    normalizeShapes(loadFromStorage<Shape[]>(STORAGE_KEYS.shapes, [])),
  )
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    loadFromStorage<HistoryItem[]>(STORAGE_KEYS.history, []),
  )

  const [isDrawing, setIsDrawing] = useState(false)
  const [tempPoints, setTempPoints] = useState<Point[]>([])
  const [textEditor, setTextEditor] = useState<{
    id: string
    x: number
    y: number
    value: string
  } | null>(null)
  const [tableEditor, setTableEditor] = useState<{
    id: string
    x: number
    y: number
    rows: number
    cols: number
  } | null>(null)

  const boardRef = useRef<HTMLDivElement | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const shapesRef = useRef<Shape[]>(shapes)
  const historyRef = useRef<HistoryItem[]>(history)
  const undoStackRef = useRef<Array<{ shapes: Shape[]; history: HistoryItem[] }>>([])
  const redoStackRef = useRef<Array<{ shapes: Shape[]; history: HistoryItem[] }>>([])
  const isUndoRedoRef = useRef(false)
  const draggingShapeRef = useRef<{
    id: string
    type: 'text' | 'table' | 'path'
    offset: Point
    size: { width: number; height: number }
  } | null>(null)
  const resizingShapeRef = useRef<{
    id: string
    originalShape: Shape
    startPointer: Point
    startBounds: ShapeBounds
  } | null>(null)
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const tableRowsRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    shapesRef.current = shapes
    saveToStorage(STORAGE_KEYS.shapes, shapes)
  }, [shapes])

  useEffect(() => {
    historyRef.current = history
    saveToStorage(STORAGE_KEYS.history, history)
  }, [history])

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.user, userName)
  }, [userName])

  useEffect(() => {
    if (textEditor && tool === 'text') {
      requestAnimationFrame(() => {
        textInputRef.current?.focus()
      })
    }
  }, [textEditor, tool])

  useEffect(() => {
    if (tool !== 'text') {
      setTextEditor(null)
    }
    if (tool !== 'table') {
      setTableEditor(null)
    }
  }, [tool])

  useEffect(() => {
    if (tableEditor && tool === 'table') {
      requestAnimationFrame(() => {
        tableRowsRef.current?.focus()
        tableRowsRef.current?.select()
      })
    }
  }, [tableEditor, tool])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
    saveToStorage(STORAGE_KEYS.theme, theme)
  }, [theme])

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  useEffect(() => {
    const checkUndoRedo = () => {
      setCanUndo(undoStackRef.current.length > 0)
      setCanRedo(redoStackRef.current.length > 0)
    }
    checkUndoRedo()
  }, [shapes, history])


  useEffect(() => {
    if (typeof window === 'undefined') return

    const channel = new BroadcastChannel('dashboard-whiteboard')
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<ChannelMessage>) => {
      const payload = event.data
      if (!payload || payload.senderId === clientId) return

      switch (payload.kind) {
        case 'add-shape':
          setShapes((prev) => [...prev, normalizeShape(payload.shape)])
          setHistory((prev) => [payload.history, ...prev])
          break
        case 'clear-board':
          setShapes([])
          setHistory((prev) => [payload.history, ...prev])
          break
        case 'update-shape':
          setShapes((prev) =>
            prev.map((shape) =>
              shape.id === payload.shape.id ? normalizeShape(payload.shape) : shape,
            ),
          )
          setHistory((prev) => [payload.history, ...prev])
          break
        case 'delete-shape':
          setShapes((prev) => prev.filter((shape) => shape.id !== payload.shapeId))
          setHistory((prev) => [payload.history, ...prev])
          break
        case 'sync-request':
          if (!shapesRef.current.length && !historyRef.current.length) return
          channel.postMessage({
            kind: 'sync-state',
            shapes: shapesRef.current,
            history: historyRef.current,
            senderId: clientId,
          } satisfies ChannelMessage)
          break
        case 'sync-state':
          setShapes(normalizeShapes(payload.shapes))
          setHistory(payload.history)
          break
        case 'undo-redo':
          isUndoRedoRef.current = true
          setShapes(normalizeShapes(payload.shapes))
          setHistory(payload.history)
          break
        default:
          break
      }
    }

    channel.addEventListener('message', handleMessage)
    channel.postMessage({ kind: 'sync-request', senderId: clientId } satisfies ChannelMessage)

    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }, [clientId])

  const broadcast = useCallback(
    (message: ChannelMessage) => {
      channelRef.current?.postMessage(message)
    },
    [channelRef],
  )

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  const handleDownloadResult = useCallback(() => {
    if (typeof window === 'undefined') return
    const boardElement = boardRef.current
    if (!boardElement) return
    const svgElement = boardElement.querySelector('svg')
    if (!svgElement) return
    const width = Math.max(Math.floor(boardElement.clientWidth), 1)
    const height = Math.max(Math.floor(boardElement.clientHeight), 1)
    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clonedSvg.setAttribute('width', String(width))
    clonedSvg.setAttribute('height', String(height))
    clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(clonedSvg)
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(svgUrl)
        return
      }
      const rootStyles = getComputedStyle(document.documentElement)
      const boardBg = rootStyles.getPropertyValue('--color-board-bg')?.trim() || '#0b1121'
      context.fillStyle = boardBg
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (!blob) {
          URL.revokeObjectURL(svgUrl)
          return
        }
        const pngUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        link.href = pngUrl
        link.download = `whiteboard-${timestamp}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(pngUrl)
        URL.revokeObjectURL(svgUrl)
      }, 'image/png')
    }
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl)
    }
    image.src = svgUrl
  }, [])

  const saveStateForUndo = useCallback(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false
      return
    }
    undoStackRef.current.push({
      shapes: [...shapesRef.current],
      history: [...historyRef.current],
    })
    undoStackRef.current = undoStackRef.current.slice(-50)
    redoStackRef.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [])

  const pushHistory = useCallback(
    (description: string, userOverride?: string) => {
      const entry: HistoryItem = {
        id: randomId(),
        timestamp: getTimestamp(),
        user: userOverride ?? userName,
        description,
      }
      setHistory((prev) => [entry, ...prev].slice(0, 250))
      return entry
    },
    [userName],
  )

  const performUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return
    const previousState = undoStackRef.current.pop()!
    redoStackRef.current.push({
      shapes: [...shapesRef.current],
      history: [...historyRef.current],
    })
    isUndoRedoRef.current = true
    setShapes(previousState.shapes)
    setHistory(previousState.history)
    setCanUndo(undoStackRef.current.length > 0)
    setCanRedo(true)
    pushHistory(`${userName} undid last action`)
    broadcast({
      kind: 'undo-redo',
      shapes: previousState.shapes,
      history: previousState.history,
      senderId: clientId,
    })
  }, [broadcast, clientId, pushHistory, userName])

  const performRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return
    const nextState = redoStackRef.current.pop()!
    undoStackRef.current.push({
      shapes: [...shapesRef.current],
      history: [...historyRef.current],
    })
    isUndoRedoRef.current = true
    setShapes(nextState.shapes)
    setHistory(nextState.history)
    setCanUndo(true)
    setCanRedo(redoStackRef.current.length > 0)
    pushHistory(`${userName} redid last action`)
    broadcast({
      kind: 'undo-redo',
      shapes: nextState.shapes,
      history: nextState.history,
      senderId: clientId,
    })
  }, [broadcast, clientId, pushHistory, userName])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        performUndo()
      } else if (
        ((event.ctrlKey || event.metaKey) && event.key === 'y') ||
        ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey)
      ) {
        event.preventDefault()
        performRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [performUndo, performRedo])

  const commitShape = useCallback(
    (shape: Shape, description: string) => {
      saveStateForUndo()
      const historyEntry = pushHistory(description)
      const normalizedShape = normalizeShape(shape)
      setShapes((prev) => [...prev, normalizedShape])
      broadcast({
        kind: 'add-shape',
        shape: normalizedShape,
        history: historyEntry,
        senderId: clientId,
      })
    },
    [broadcast, clientId, pushHistory, saveStateForUndo],
  )

  const applyShapeUpdate = useCallback(
    (updatedShape: Shape, description: string, options?: { skipUndoSnapshot?: boolean }) => {
      if (!options?.skipUndoSnapshot) {
        saveStateForUndo()
      }
      const normalizedShape = normalizeShape(updatedShape)
      const historyEntry = pushHistory(description)
      setShapes((prev) =>
        prev.map((shape) => (shape.id === normalizedShape.id ? normalizedShape : shape)),
      )
      broadcast({
        kind: 'update-shape',
        shape: normalizedShape,
        history: historyEntry,
        senderId: clientId,
      })
    },
    [broadcast, clientId, pushHistory, saveStateForUndo],
  )

  const commitPath = useCallback(
    (points: Point[]) => {
      if (points.length < 2) return
      const shape: PathShape = {
        id: randomId(),
        type: 'path',
        createdAt: getTimestamp(),
        createdBy: userName,
        points,
        stroke: color,
        strokeWidth,
      }
      commitShape(shape, `${userName} drew a stroke (${points.length} pts)`)
    },
    [color, commitShape, strokeWidth, userName],
  )

  const getTableCellAtPoint = useCallback(
    (point: Point) => {
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        const shape = shapes[index]
        if (shape.type !== 'table') continue
        const normalizedTable = ensureTableCells(shape)
        const width = normalizedTable.cols * normalizedTable.cellWidth
        const height = normalizedTable.rows * normalizedTable.cellHeight
        const withinX =
          point.x >= normalizedTable.x && point.x <= normalizedTable.x + width
        const withinY =
          point.y >= normalizedTable.y && point.y <= normalizedTable.y + height
        if (!withinX || !withinY) continue
        const col = Math.floor((point.x - normalizedTable.x) / normalizedTable.cellWidth)
        const row = Math.floor((point.y - normalizedTable.y) / normalizedTable.cellHeight)
        if (
          row < 0 ||
          row >= normalizedTable.rows ||
          col < 0 ||
          col >= normalizedTable.cols
        ) {
          continue
        }
        return { shape: normalizedTable, row, col } as const
      }
      return null
    },
    [shapes],
  )

  const findShapeAtPoint = useCallback(
    (point: Point) => {
      for (let index = shapesRef.current.length - 1; index >= 0; index -= 1) {
        const shape = shapesRef.current[index]
        if (shape.type === 'table' || shape.type === 'text') {
          const bounds = getShapeBounds(shape)
          if (isPointInsideBounds(point, bounds)) {
            return shape
          }
        } else if (shape.type === 'path') {
          for (let i = 0; i < shape.points.length - 1; i += 1) {
            if (isPointNearSegment(point, shape.points[i], shape.points[i + 1], ERASER_RADIUS)) {
              return shape
            }
          }
        }
      }
      return null
    },
    [],
  )

  const updateTableCell = useCallback(
    (tableShape: TableShape, row: number, col: number, value: string) => {
      const normalizedTable = ensureTableCells(tableShape)
      const sanitizedValue = value.trim()
      if (normalizedTable.cells[row]?.[col] === sanitizedValue) return
      const updatedCells = normalizedTable.cells.map((cellRow, rowIndex) =>
        rowIndex === row
          ? cellRow.map((cellValue, colIndex) =>
              colIndex === col ? sanitizedValue : cellValue,
            )
          : cellRow,
      )
      const updatedShape: TableShape = { ...normalizedTable, cells: updatedCells }
      applyShapeUpdate(
        updatedShape,
        `${userName} updated cell R${row + 1}C${col + 1}`,
      )
    },
    [applyShapeUpdate, userName],
  )

  const finalizeTextEditor = useCallback(
    (shouldCommit: boolean) => {
      setTextEditor((current) => {
        if (!current) return null
        if (shouldCommit) {
          const trimmed = current.value.trim()
          if (trimmed) {
            const shape: TextShape = {
              id: current.id,
              type: 'text',
              createdAt: getTimestamp(),
              createdBy: userName,
              x: current.x,
              y: current.y,
              text: trimmed,
              color,
              fontSize: DEFAULT_FONT_SIZE,
            }
            commitShape(shape, `${userName} added text "${shape.text}"`)
          }
        }
        return null
      })
    },
    [color, commitShape, userName],
  )

  const handleTextEditorChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value
    setTextEditor((current) => (current ? { ...current, value: nextValue } : current))
  }, [])

  const getPointerPosition = useCallback((clientX: number, clientY: number) => {
    const board = boardRef.current
    if (!board) return null
    const rect = board.getBoundingClientRect()
    return {
      point: {
        x: clamp(clientX - rect.left, 0, rect.width),
        y: clamp(clientY - rect.top, 0, rect.height),
      },
      bounds: {
        width: rect.width,
        height: rect.height,
      },
    }
  }, [])

  const getRelativePoint = (event: React.PointerEvent<Element>) =>
    getPointerPosition(event.clientX, event.clientY)?.point ?? null

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'move' || tool === 'resize') return
    if (tool === 'text' && textEditor) {
      finalizeTextEditor(true)
    }

    const point = getRelativePoint(event)
    if (!point) return

    if (tool === 'eraser') {
      const targetShape = findShapeAtPoint(point)
      if (!targetShape) return
      const description =
        targetShape.type === 'text'
          ? `${userName} erased text "${targetShape.text}"`
          : targetShape.type === 'table'
            ? `${userName} erased a ${targetShape.rows}x${targetShape.cols} table`
            : `${userName} erased a stroke`
      deleteShape(targetShape.id, description)
      return
    }

    if (tool === 'pen') {
      setTempPoints([point])
      setIsDrawing(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }

    if (tool === 'text') {
      const tableCell = getTableCellAtPoint(point)
      if (tableCell) {
        const { shape, row, col } = tableCell
        const currentValue = shape.cells[row][col] ?? ''
        const nextValue = window.prompt('Text for this cell?', currentValue)
        if (nextValue === null) return
        updateTableCell(shape, row, col, nextValue)
        return
      }

      setTextEditor({
        id: randomId(),
        x: point.x,
        y: point.y,
        value: '',
      })
      return
    }

    if (tool === 'table') {
      const rows = Number(window.prompt('How many rows? (1-12)', '3')) || 0
      const cols = Number(window.prompt('How many columns? (1-12)', '4')) || 0
      if (!rows || !cols) return

      const clampedRows = clamp(rows, 1, 12)
      const clampedCols = clamp(cols, 1, 12)
      const shape: TableShape = {
        id: randomId(),
        type: 'table',
        createdAt: getTimestamp(),
        createdBy: userName,
        x: point.x,
        y: point.y,
        rows: clampedRows,
        cols: clampedCols,
        cellWidth: 80,
        cellHeight: 40,
        stroke: color,
        cells: Array.from({ length: clampedRows }, () =>
          Array.from({ length: clampedCols }, () => ''),
        ),
      }

      commitShape(
        shape,
        `${userName} created a ${shape.rows}x${shape.cols} table`,
      )
    }
  }

  const handleShapePointerDown = useCallback(
    (event: React.PointerEvent<Element>, shape: Shape) => {
      if (tool !== 'move') return
      if (shape.type !== 'text' && shape.type !== 'table' && shape.type !== 'path') return
      const position = getPointerPosition(event.clientX, event.clientY)
      if (!position) return
      event.stopPropagation()
      event.preventDefault()
      if (draggingShapeRef.current) return
      saveStateForUndo()
      const bounds = getShapeBounds(shape)
      const anchor =
        shape.type === 'text'
          ? { x: shape.x, y: shape.y }
          : { x: bounds.minX, y: bounds.minY }
      draggingShapeRef.current = {
        id: shape.id,
        type: shape.type,
        offset: {
          x: position.point.x - anchor.x,
          y: position.point.y - anchor.y,
        },
        size: {
          width: bounds.width,
          height: bounds.height,
        },
      }
    },
    [getPointerPosition, saveStateForUndo, tool],
  )

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<Element>, shape: Shape) => {
      if (tool !== 'resize') return
      if (resizingShapeRef.current) return
      const position = getPointerPosition(event.clientX, event.clientY)
      if (!position) return
      event.stopPropagation()
      event.preventDefault()
      saveStateForUndo()
      resizingShapeRef.current = {
        id: shape.id,
        originalShape: cloneShape(shape),
        startPointer: position.point,
        startBounds: getShapeBounds(shape),
      }
    },
    [getPointerPosition, saveStateForUndo, tool],
  )

  const finalizeShapeDrag = useCallback(() => {
    const drag = draggingShapeRef.current
    if (!drag) return
    const target = shapesRef.current.find((shape) => shape.id === drag.id)
    draggingShapeRef.current = null
    if (!target || (target.type !== 'text' && target.type !== 'table' && target.type !== 'path')) {
      return
    }
    const description =
      target.type === 'text'
        ? `${userName} moved text "${target.text}"`
        : target.type === 'table'
          ? `${userName} moved ${target.rows}x${target.cols} table`
          : `${userName} moved a stroke`
    applyShapeUpdate(target, description, { skipUndoSnapshot: true })
  }, [applyShapeUpdate, userName])

  const finalizeShapeResize = useCallback(() => {
    const resizeState = resizingShapeRef.current
    if (!resizeState) return
    const target = shapesRef.current.find((shape) => shape.id === resizeState.id)
    resizingShapeRef.current = null
    if (!target) return
    const description =
      target.type === 'text'
        ? `${userName} resized text "${target.text}"`
        : target.type === 'table'
          ? `${userName} resized ${target.rows}x${target.cols} table`
          : `${userName} resized a stroke`
    applyShapeUpdate(target, description, { skipUndoSnapshot: true })
  }, [applyShapeUpdate, userName])

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizingShapeRef.current) {
      const position = getPointerPosition(event.clientX, event.clientY)
      if (!position) return
      const resizeState = resizingShapeRef.current
      const deltaX = position.point.x - resizeState.startPointer.x
      const deltaY = position.point.y - resizeState.startPointer.y
      const nextWidth = Math.max(
        resizeState.startBounds.width + deltaX,
        MIN_RESIZE_DIMENSION,
      )
      const nextHeight = Math.max(
        resizeState.startBounds.height + deltaY,
        MIN_RESIZE_DIMENSION,
      )
      const baseWidth = Math.max(resizeState.startBounds.width, 1)
      const baseHeight = Math.max(resizeState.startBounds.height, 1)
      const scaleX = nextWidth / baseWidth
      const scaleY = nextHeight / baseHeight
      setShapes((prev) =>
        prev.map((shape) => {
          if (shape.id !== resizeState.id) return shape
          const original = resizeState.originalShape
          if (original.type === 'table') {
            return {
              ...shape,
              cellWidth: Math.max(original.cellWidth * scaleX, MIN_TABLE_CELL),
              cellHeight: Math.max(original.cellHeight * scaleY, MIN_TABLE_CELL),
            }
          }
          if (original.type === 'text') {
            const scale = Math.max(scaleX, scaleY)
            return {
              ...shape,
              fontSize: clamp(original.fontSize * scale, MIN_TEXT_SIZE, MAX_TEXT_SIZE),
            }
          }
          if (original.type === 'path') {
            const minX = resizeState.startBounds.minX
            const minY = resizeState.startBounds.minY
            const scaledPoints = original.points.map((point) => ({
              x: clamp(
                minX + (point.x - minX) * scaleX,
                0,
                position.bounds.width,
              ),
              y: clamp(
                minY + (point.y - minY) * scaleY,
                0,
                position.bounds.height,
              ),
            }))
            return { ...shape, points: scaledPoints }
          }
          return shape
        }),
      )
      return
    }
    if (draggingShapeRef.current) {
      const position = getPointerPosition(event.clientX, event.clientY)
      if (!position) return
      const { id, size } = draggingShapeRef.current
      const offset = draggingShapeRef.current.offset
      const { point, bounds } = position
      setShapes((prev) =>
        prev.map((shape) => {
          if (shape.id !== id) return shape
          const nextX = point.x - offset.x
          const nextY = point.y - offset.y
          if (shape.type === 'table') {
            const tableWidth = shape.cols * shape.cellWidth
            const tableHeight = shape.rows * shape.cellHeight
            return {
              ...shape,
              x: clamp(nextX, 0, Math.max(bounds.width - tableWidth, 0)),
              y: clamp(nextY, 0, Math.max(bounds.height - tableHeight, 0)),
            }
          }
          if (shape.type === 'text') {
            return {
              ...shape,
              x: clamp(nextX, 0, bounds.width),
              y: clamp(nextY, 0, bounds.height),
            }
          }
          if (shape.type === 'path') {
            const targetMinX = clamp(nextX, 0, Math.max(bounds.width - size.width, 0))
            const targetMinY = clamp(nextY, 0, Math.max(bounds.height - size.height, 0))
            const currentBounds = getShapeBounds(shape)
            const deltaX = targetMinX - currentBounds.minX
            const deltaY = targetMinY - currentBounds.minY
            if (!deltaX && !deltaY) return shape
            const movedPoints = shape.points.map((pt) => ({
              x: clamp(pt.x + deltaX, 0, bounds.width),
              y: clamp(pt.y + deltaY, 0, bounds.height),
            }))
            return { ...shape, points: movedPoints }
          }
          return shape
        }),
      )
      return
    }
    if (!isDrawing || tool !== 'pen') return
    const point = getRelativePoint(event)
    if (!point) return
    setTempPoints((prev) => [...prev, point])
  }

  const handlePointerUp = () => {
    if (resizingShapeRef.current) {
      finalizeShapeResize()
      return
    }
    if (draggingShapeRef.current) {
      finalizeShapeDrag()
      return
    }
    if (!isDrawing) return
    if (tempPoints.length >= 2) {
      commitPath(tempPoints)
    }
    setTempPoints([])
    setIsDrawing(false)
  }

  const clearBoard = () => {
    if (!shapes.length) return
    saveStateForUndo()
    const historyEntry = pushHistory(`${userName} cleared the board`)
    setShapes([])
    broadcast({
      kind: 'clear-board',
      history: historyEntry,
      senderId: clientId,
    })
  }

  const deleteShape = useCallback(
    (shapeId: string, description: string) => {
      saveStateForUndo()
      setShapes((prev) => prev.filter((shape) => shape.id !== shapeId))
      const historyEntry = pushHistory(description)
      broadcast({
        kind: 'delete-shape',
        shapeId,
        history: historyEntry,
        senderId: clientId,
      })
    },
    [broadcast, clientId, pushHistory, saveStateForUndo],
  )

  const renderResizeOverlay = (shape: Shape) => {
    if (tool !== 'resize') return null
    const bounds = getShapeBounds(shape)
    const handleSize = 14
    const outlineWidth = Math.max(bounds.width, MIN_RESIZE_DIMENSION)
    const outlineHeight = Math.max(bounds.height, MIN_RESIZE_DIMENSION)
    const outlineX = bounds.minX
    const outlineY = bounds.minY
    return (
      <>
        <rect
          className="resize-outline"
          x={outlineX}
          y={outlineY}
          width={outlineWidth}
          height={outlineHeight}
          pointerEvents="none"
        />
        <rect
          className="resize-handle"
          x={outlineX + outlineWidth - handleSize}
          y={outlineY + outlineHeight - handleSize}
          width={handleSize}
          height={handleSize}
          onPointerDown={(event) => handleResizePointerDown(event, shape)}
        />
      </>
    )
  }

  const renderShape = (shape: Shape) => {
    let node: React.ReactNode = null

    switch (shape.type) {
      case 'path':
        node = (
          <polyline
            className={`path-stroke ${tool === 'move' ? 'movable-shape' : ''}`}
            points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            onPointerDown={
              tool === 'move'
                ? (event) => handleShapePointerDown(event, shape)
                : undefined
            }
          />
        )
        break
      case 'text':
        node = (
          <text
            x={shape.x}
            y={shape.y}
            fill={shape.color}
            fontSize={shape.fontSize}
            className={`board-text ${tool === 'move' ? 'movable-shape' : ''}`}
            onPointerDown={
              tool === 'move'
                ? (event) => handleShapePointerDown(event, shape)
                : undefined
            }
          >
            {shape.text}
          </text>
        )
        break
      case 'table': {
        const width = shape.cols * shape.cellWidth
        const height = shape.rows * shape.cellHeight
        const horizontal = Array.from({ length: shape.rows - 1 }, (_, row) => (
          <line
            key={`h-${row}`}
            x1={shape.x}
            y1={shape.y + shape.cellHeight * (row + 1)}
            x2={shape.x + width}
            y2={shape.y + shape.cellHeight * (row + 1)}
            stroke={shape.stroke}
            strokeWidth={1}
            opacity={0.6}
          />
        ))
        const vertical = Array.from({ length: shape.cols - 1 }, (_, col) => (
          <line
            key={`v-${col}`}
            x1={shape.x + shape.cellWidth * (col + 1)}
            y1={shape.y}
            x2={shape.x + shape.cellWidth * (col + 1)}
            y2={shape.y + height}
            stroke={shape.stroke}
            strokeWidth={1}
            opacity={0.6}
          />
        ))
        const textNodes: React.ReactNode[] = []
        for (let row = 0; row < shape.rows; row += 1) {
          for (let col = 0; col < shape.cols; col += 1) {
            const cellValue = shape.cells[row]?.[col]
            if (!cellValue) continue
            const cx = shape.x + col * shape.cellWidth + shape.cellWidth / 2
            const cy = shape.y + row * shape.cellHeight + shape.cellHeight / 2 + 4
            textNodes.push(
              <text
                key={`cell-${row}-${col}`}
                x={cx}
                y={cy}
                className="table-cell-text"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {cellValue}
              </text>,
            )
          }
        }
        node = (
          <g
            className={`board-table ${tool === 'move' ? 'movable-shape' : ''}`}
            onPointerDown={
              tool === 'move'
                ? (event) => handleShapePointerDown(event, shape)
                : undefined
            }
          >
            <rect
              x={shape.x}
              y={shape.y}
              width={width}
              height={height}
              fill="var(--color-table-fill)"
              stroke={shape.stroke}
              strokeWidth={1.5}
              rx={4}
            />
            {horizontal}
            {vertical}
            {textNodes}
          </g>
        )
        break
      }
      default:
        node = null
    }

    if (!node) return null

    return (
      <g key={shape.id}>
        {node}
        {renderResizeOverlay(shape)}
      </g>
    )
  }

  const activeToolLabel = {
    pen: 'Pencil',
    text: 'Text',
    table: 'Table',
    move: 'Move',
    resize: 'Resize',
    eraser: 'Erase',
  }[tool]

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <p className="app-eyebrow">Realtime dashboard</p>
          <h1>Collaborative Whiteboard</h1>
          <p className="app-subtitle">
            Draw with teammates, drop quick notes, build lightweight tables, and
            track every interaction in the activity stream.
          </p>
        </div>
        <div className="header-actions">
          <div className="user-badge">
            <label htmlFor="userName">Display name</label>
            <input
              id="userName"
              value={userName}
              onChange={(event) => setUserName(event.target.value.slice(0, 32))}
              placeholder="Your name"
            />
          </div>
          <div className="theme-toggle">
            <label htmlFor="themeToggle">Appearance</label>
            <button
              id="themeToggle"
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'dark' ? '🌞 Light mode' : '🌙 Dark mode'}
            </button>
          </div>
        </div>
      </header>

      <section className="content">
        <aside className="panel tool-panel">
          <p className="panel-title">Create</p>
          <div className="tool-grid">
            {(['pen', 'text', 'table', 'move', 'resize', 'eraser'] as Tool[]).map((item) => (
              <button
                key={item}
                className={`tool-btn ${tool === item ? 'active' : ''}`}
                onClick={() => setTool(item)}
              >
                {item === 'pen' && '✏️ Pencil'}
                {item === 'text' && '📝 Text'}
                {item === 'table' && '📊 Table'}
                {item === 'move' && '🤚 Move'}
                {item === 'resize' && '📐 Resize'}
                {item === 'eraser' && '🧽 Eraser'}
              </button>
            ))}
          </div>

          <div className="control">
            <label>Ink color</label>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>

          <div className="control">
            <label>Pencil width: {strokeWidth}px</label>
            <input
              type="range"
              min={2}
              max={12}
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
              style={{ accentColor: color }}
            />
          </div>

          <div className="control">
            <label>Active tool</label>
            <p className="active-tool">{activeToolLabel}</p>
          </div>

          <div className="undo-redo-controls">
            <button
              className="ghost-btn"
              onClick={performUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              className="ghost-btn"
              onClick={performRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
            >
              ↷ Redo
            </button>
          </div>

          <button className="primary-btn" type="button" onClick={handleDownloadResult}>
            ⬇ Download PNG
          </button>

          <button className="danger-btn" onClick={clearBoard}>
            Clear board
          </button>
        </aside>

        <div className="board-wrapper">
          <div
            ref={boardRef}
            className={`board ${tool === 'move' ? 'move-mode' : ''} ${
              tool === 'resize' ? 'resize-mode' : ''
            } ${tool === 'eraser' ? 'eraser-mode' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <svg className="board-canvas">
              {shapes.map((shape) => renderShape(shape))}
              {isDrawing && tempPoints.length > 1 && (
                <polyline
                  className="path-stroke preview"
                  points={tempPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
            </svg>
            {textEditor && tool === 'text' && (
              <textarea
                ref={textInputRef}
                className="text-editor"
                style={{
                  left: textEditor.x,
                  top: Math.max(textEditor.y - DEFAULT_FONT_SIZE * 1.2, 0),
                }}
                value={textEditor.value}
                onChange={handleTextEditorChange}
                onBlur={() => finalizeTextEditor(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    finalizeTextEditor(true)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    finalizeTextEditor(false)
                  }
                }}
                placeholder="Type here..."
              />
            )}
          </div>
        </div>

        <aside className="panel history-panel">
          <div className="history-header">
            <div>
              <p className="panel-title">History</p>
              <p className="history-meta">
                {history.length ? `${history.length} events` : 'No activity'}
              </p>
            </div>
            <button
              className="ghost-btn"
              onClick={() =>
                window.alert('Open this dashboard in another tab to collaborate in real-time!')
              }
            >
              Invite
            </button>
          </div>
          <ul className="history-list">
            {history.map((entry) => (
              <li key={entry.id} className="history-row">
                <div>
                  <p className="history-description">{entry.description}</p>
                  <p className="history-user">{entry.user}</p>
                </div>
                <span className="history-time">{formatTime(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </div>
  )
}

export default App
