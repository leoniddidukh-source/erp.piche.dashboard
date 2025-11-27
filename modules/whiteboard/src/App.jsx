import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { RichTextEditor } from './RichTextEditor'

const STORAGE_KEYS = {
  shapes: 'dashboard.whiteboard.shapes',
  history: 'dashboard.whiteboard.history',
  user: 'dashboard.whiteboard.user',
  theme: 'dashboard.whiteboard.theme',
}

const randomId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 11)

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const DEFAULT_FONT_SIZE = 18
const MIN_TEXT_SIZE = 10
const MAX_TEXT_SIZE = 120
const MIN_TABLE_CELL = 20
const MIN_RESIZE_DIMENSION = 16
const MIN_PATH_DIMENSION = 4
const ERASER_RADIUS = 18
const DEFAULT_CELL_COLOR = '#e2e8f0'
const DEFAULT_BOARD_WIDTH = 2400
const DEFAULT_BOARD_HEIGHT = 1600
const BOARD_MARGIN = 400
const AUTO_SCROLL_EDGE = 80
const AUTO_SCROLL_SPEED = 40

const buildPencilCursor = (hexColor) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="${hexColor}" d="M2 17.75V22h4.25L19.81 8.44l-4.24-4.24zm19.71-11.04a1 1 0 0 0 0-1.41l-2.01-2.01a1 1 0 0 0-1.41 0l-1.83 1.83l4.24 4.24z"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 1 23, crosshair`
}

const extractPlainText = (html) => {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  }
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  return tempDiv.textContent || tempDiv.innerText || ''
}

const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i

const escapeHtml = (value) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

const normalizeHtmlContent = (value) => {
  if (!value) return ''
  if (HTML_TAG_REGEX.test(value)) return value
  return escapeHtml(value).replace(/\n/g, '<br/>')
}

const sanitizeHtmlValue = (value) => {
  const normalized = normalizeHtmlContent(value.trim())
  const plain = extractPlainText(normalized).trim()
  return plain ? normalized : ''
}

const getShapeBounds = (shape) => {
  if (!shape) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: MIN_RESIZE_DIMENSION,
      height: MIN_RESIZE_DIMENSION,
    }
  }

  switch (shape.type) {
    case 'text': {
      const plainText = extractPlainText(shape.text || '')
      const lines = plainText.split('\n')
      const charWidth = shape.fontSize * 0.6
      const lineHeight = shape.fontSize * 1.2
      const maxLineLength = Math.max(...lines.map((line) => line.length), 1)
      const width = Math.max(charWidth * maxLineLength, shape.fontSize)
      const height = lineHeight * lines.length
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
      if (!shape.points || !shape.points.length) {
        const x = shape.points && shape.points[0] ? shape.points[0].x : 0
        const y = shape.points && shape.points[0] ? shape.points[0].y : 0
        return {
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
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
    case 'rectangle': {
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.width,
        maxY: shape.y + shape.height,
        width: shape.width,
        height: shape.height,
      }
    }
    case 'circle': {
      return {
        minX: shape.cx - shape.r,
        minY: shape.cy - shape.r,
        maxX: shape.cx + shape.r,
        maxY: shape.cy + shape.r,
        width: shape.r * 2,
        height: shape.r * 2,
      }
    }
    case 'ellipse': {
      return {
        minX: shape.cx - shape.rx,
        minY: shape.cy - shape.ry,
        maxX: shape.cx + shape.rx,
        maxY: shape.cy + shape.ry,
        width: shape.rx * 2,
        height: shape.ry * 2,
      }
    }
    case 'line': {
      const minX = Math.min(shape.x1, shape.x2)
      const maxX = Math.max(shape.x1, shape.x2)
      const minY = Math.min(shape.y1, shape.y2)
      const maxY = Math.max(shape.y1, shape.y2)
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      }
    }
    default:
      return {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: MIN_RESIZE_DIMENSION,
        height: MIN_RESIZE_DIMENSION,
      }
  }
}

const getTimestamp = () => Date.now()

const loadFromStorage = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (error) {
    console.warn(`Failed to read ${key} from storage`, error)
    return fallback
  }
}

const saveToStorage = (key, value) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Failed to save ${key} in storage`, error)
  }
}

const getPreferredTheme = () => {
  if (typeof window === 'undefined') return 'dark'
  const storedTheme = loadFromStorage(STORAGE_KEYS.theme, null)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
  return prefersLight ? 'light' : 'dark'
}

const formatTime = (timestamp) =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(timestamp)

const ensureTableCells = (shape) => {
  const legacyCells = shape.cells
  const normalizedCells = Array.from({ length: shape.rows }, (_, rowIndex) => {
    const existingRow = (legacyCells && legacyCells[rowIndex]) || []
    return Array.from({ length: shape.cols }, (_, colIndex) => {
      const existingCell = existingRow[colIndex]
      if (!existingCell) {
        return { value: '', color: DEFAULT_CELL_COLOR }
      }
      if (typeof existingCell === 'string') {
        return { value: existingCell, color: DEFAULT_CELL_COLOR }
      }
      return {
        value: existingCell.value ?? '',
        color: existingCell.color ?? DEFAULT_CELL_COLOR,
      }
    })
  })
  return { ...shape, cells: normalizedCells }
}

const normalizeShape = (shape) => {
  if (!shape) return shape
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

const normalizeShapes = (shapes) => shapes.map(normalizeShape)

const cloneShape = (shape) => {
  if (!shape) return shape
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

const distanceSquared = (a, b) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

const isPointNearSegment = (point, segmentStart, segmentEnd, threshold) => {
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

const isPointInsideBounds = (point, bounds) =>
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY

function App() {
  const clientId = useMemo(() => randomId(), [])

  const [theme, setTheme] = useState(() => getPreferredTheme())
  const [userName, setUserName] = useState(() => {
    const stored = loadFromStorage(STORAGE_KEYS.user, '')
    if (stored) return stored
    return `Guest-${Math.floor(Math.random() * 900 + 100)}`
  })

  const [tool, setTool] = useState('pen') // 'pen' | 'text' | 'table' | 'shapes' | 'move' | 'resize' | 'eraser'
  const [color, setColor] = useState('#22d3ee')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [shapeType, setShapeType] = useState('rectangle') // 'rectangle' | 'circle' | 'line' | 'ellipse'
  const [isDrawingShape, setIsDrawingShape] = useState(false)
  const [tempShape, setTempShape] = useState(null)

  const [shapes, setShapes] = useState(() =>
      normalizeShapes(loadFromStorage(STORAGE_KEYS.shapes, [])),
  )
  const [history, setHistory] = useState(() =>
      loadFromStorage(STORAGE_KEYS.history, []),
  )

  const [isDrawing, setIsDrawing] = useState(false)
  const [tempPoints, setTempPoints] = useState([])

  const [textEditor, setTextEditor] = useState(null)
  const [cellEditor, setCellEditor] = useState(null)
  const [tableEditor, setTableEditor] = useState(null)

  const boardWrapperRef = useRef(null)
  const boardRef = useRef(null)
  const boardSvgRef = useRef(null)
  const channelRef = useRef(null)
  const shapesRef = useRef(shapes)
  const historyRef = useRef(history)
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])
  const isUndoRedoRef = useRef(false)
  const draggingShapeRef = useRef(null)
  const resizingShapeRef = useRef(null)
  const textInputRef = useRef(null)
  const cellInputRef = useRef(null)
  const tableRowsRef = useRef(null)

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
    if (tableEditor && tool === 'table') {
      requestAnimationFrame(() => {
        if (tableRowsRef.current) {
          tableRowsRef.current.focus()
          tableRowsRef.current.select()
        }
      })
    }
  }, [tableEditor, tool])

  useEffect(() => {
    if (cellEditor && tool === 'text') {
      requestAnimationFrame(() => {
        cellInputRef.current?.focus()
      })
    }
  }, [cellEditor, tool])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
    saveToStorage(STORAGE_KEYS.theme, theme)
  }, [theme])

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const handleToolChange = useCallback((nextTool) => {
    setTool(nextTool)
    if (nextTool !== 'text') {
      setTextEditor(null)
      setCellEditor(null)
    }
    if (nextTool !== 'table') {
      setTableEditor(null)
    }
  }, [])

  const boardDimensions = useMemo(() => {
    let maxX = 0
    let maxY = 0
    for (const shape of shapes) {
      const bounds = getShapeBounds(shape)
      maxX = Math.max(maxX, bounds.maxX)
      maxY = Math.max(maxY, bounds.maxY)
    }
    return {
      width: Math.max(DEFAULT_BOARD_WIDTH, Math.ceil(maxX + BOARD_MARGIN)),
      height: Math.max(DEFAULT_BOARD_HEIGHT, Math.ceil(maxY + BOARD_MARGIN)),
    }
  }, [shapes])

  const autoScrollBoard = useCallback((point) => {
    const container = boardWrapperRef.current
    if (!container || !point) return null

    const relativeX = point.x - container.scrollLeft
    const relativeY = point.y - container.scrollTop

    let deltaX = 0
    let deltaY = 0

    if (relativeX < AUTO_SCROLL_EDGE) {
      deltaX = -AUTO_SCROLL_SPEED
    } else if (relativeX > container.clientWidth - AUTO_SCROLL_EDGE) {
      deltaX = AUTO_SCROLL_SPEED
    }

    if (relativeY < AUTO_SCROLL_EDGE) {
      deltaY = -AUTO_SCROLL_SPEED
    } else if (relativeY > container.clientHeight - AUTO_SCROLL_EDGE) {
      deltaY = AUTO_SCROLL_SPEED
    }

    if (deltaX !== 0 || deltaY !== 0) {
      container.scrollBy({
        left: deltaX,
        top: deltaY,
        behavior: 'auto',
      })
      return { deltaX, deltaY }
    }
    return null
  }, [])

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

    const handleMessage = (event) => {
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
          })
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
    channel.postMessage({ kind: 'sync-request', senderId: clientId })

    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }, [clientId])

  const broadcast = useCallback((message) => {
    channelRef.current?.postMessage(message)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  const handleDownloadResult = useCallback(() => {
    if (typeof window === 'undefined') return
    const boardElement = boardRef.current
    const svgElement = boardSvgRef.current
    if (!boardElement || !svgElement) return

    const width = Math.max(Math.floor(boardElement.clientWidth), 1)
    const height = Math.max(Math.floor(boardElement.clientHeight), 1)

    const clonedSvg = svgElement.cloneNode(true)
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
      const boardBg =
          rootStyles.getPropertyValue('--color-board-bg')?.trim() || '#0b1121'
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
      (description, userOverride) => {
        const entry = {
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
    const previousState = undoStackRef.current.pop()
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
    const nextState = redoStackRef.current.pop()
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
    const handleKeyDown = (event) => {
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
      (shape, description) => {
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
      (updatedShape, description, options) => {
        if (!options || !options.skipUndoSnapshot) {
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
      (points) => {
        if (!points || points.length < 2) return
        const shape = {
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
      (point) => {
        for (let index = shapes.length - 1; index >= 0; index -= 1) {
          const shape = shapes[index]
          if (!shape || shape.type !== 'table') continue
          const normalizedTable = ensureTableCells(shape)
          const width = normalizedTable.cols * normalizedTable.cellWidth
          const height = normalizedTable.rows * normalizedTable.cellHeight
          const withinX =
              point.x >= normalizedTable.x && point.x <= normalizedTable.x + width
          const withinY =
              point.y >= normalizedTable.y && point.y <= normalizedTable.y + height
          if (!withinX || !withinY) continue
          const col = Math.floor(
              (point.x - normalizedTable.x) / normalizedTable.cellWidth,
          )
          const row = Math.floor(
              (point.y - normalizedTable.y) / normalizedTable.cellHeight,
          )
          if (
              row < 0 ||
              row >= normalizedTable.rows ||
              col < 0 ||
              col >= normalizedTable.cols
          ) {
            continue
          }
          return { shape: normalizedTable, row, col }
        }
        return null
      },
      [shapes],
  )

  const findShapeAtPoint = useCallback((point) => {
    const list = shapesRef.current || []
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const shape = list[index]
      if (!shape) continue
      if (
          shape.type === 'table' ||
          shape.type === 'text' ||
          shape.type === 'rectangle' ||
          shape.type === 'circle' ||
          shape.type === 'ellipse'
      ) {
        const bounds = getShapeBounds(shape)
        if (isPointInsideBounds(point, bounds)) {
          return shape
        }
      } else if (shape.type === 'path') {
        for (let i = 0; i < shape.points.length - 1; i += 1) {
          if (
              isPointNearSegment(
                  point,
                  shape.points[i],
                  shape.points[i + 1],
                  ERASER_RADIUS,
              )
          ) {
            return shape
          }
        }
      } else if (shape.type === 'line') {
        if (
            isPointNearSegment(
                point,
                { x: shape.x1, y: shape.y1 },
                { x: shape.x2, y: shape.y2 },
                ERASER_RADIUS,
            )
        ) {
          return shape
        }
      }
    }
    return null
  }, [])

  const updateTableCell = useCallback(
      (tableShape, row, col, value, options) => {
        const normalizedTable = ensureTableCells(tableShape)
        const sanitizedValue = sanitizeHtmlValue(value)
        const targetRow = normalizedTable.cells[row]
        if (!targetRow) return
        const existingCell = targetRow[col]
        const nextColor =
            (options && options.color) ||
            (existingCell && existingCell.color) ||
            DEFAULT_CELL_COLOR
        if (
            existingCell &&
            existingCell.value === sanitizedValue &&
            existingCell.color === nextColor
        ) {
          return
        }
        const updatedCells = normalizedTable.cells.map((cellRow, rowIndex) =>
            rowIndex === row
                ? cellRow.map((cell, colIndex) =>
                    colIndex === col ? { value: sanitizedValue, color: nextColor } : cell,
                )
                : cellRow,
        )
        const updatedShape = { ...normalizedTable, cells: updatedCells }
        applyShapeUpdate(
            updatedShape,
            `${userName} updated cell R${row + 1}C${col + 1}`,
        )
      },
      [applyShapeUpdate, userName],
  )

  const finalizeTextEditor = useCallback(
      (shouldCommit) => {
        setTextEditor((current) => {
          if (!current) return null
          if (shouldCommit) {
            const htmlContent = (current.value || '').trim()
            const plainText = extractPlainText(htmlContent).trim()
            if (plainText && htmlContent) {
              if (current.mode === 'edit' && current.shapeId) {
                const existingShape = shapesRef.current.find(
                    (shape) =>
                        shape &&
                        shape.id === current.shapeId &&
                        shape.type === 'text',
                )
                if (existingShape) {
                  const updatedShape = {
                    ...existingShape,
                    text: htmlContent,
                    fontSize: current.fontSize ?? existingShape.fontSize,
                    color: current.originalColor ?? existingShape.color,
                  }
                  applyShapeUpdate(
                      updatedShape,
                      `${userName} edited text "${plainText}"`,
                  )
                }
              } else {
                const shape = {
                  id: current.id,
                  type: 'text',
                  createdAt: getTimestamp(),
                  createdBy: userName,
                  x: current.x,
                  y: current.y,
                  text: htmlContent,
                  color,
                  fontSize: DEFAULT_FONT_SIZE,
                }
                commitShape(shape, `${userName} added text "${plainText}"`)
              }
            }
          }
          return null
        })
      },
      [applyShapeUpdate, color, commitShape, userName],
  )

  const handleTextEditorChange = useCallback((value) => {
    setTextEditor((current) => (current ? { ...current, value } : current))
  }, [])

  const handleCellEditorChange = useCallback((value) => {
    setCellEditor((current) => (current ? { ...current, value } : current))
  }, [])

  const finalizeCellEditor = useCallback(
      (shouldCommit) => {
        setCellEditor((current) => {
          if (!current) return null
          if (shouldCommit) {
            const sanitized = sanitizeHtmlValue(current.value || '')
            const tableShape = shapesRef.current.find(
                (shape) => shape && shape.id === current.tableId && shape.type === 'table',
            )
            if (tableShape) {
              updateTableCell(tableShape, current.row, current.col, sanitized, {
                color,
              })
            }
          }
          return null
        })
      },
      [color, updateTableCell],
  )

  const finalizeTableEditor = useCallback(
      (shouldCommit) => {
        setTableEditor((current) => {
          if (!current) return null
          if (shouldCommit) {
            const rows = clamp(Math.round(current.rows), 1, 12)
            const cols = clamp(Math.round(current.cols), 1, 12)
            if (rows && cols) {
              const shape = {
                id: current.id,
                type: 'table',
                createdAt: getTimestamp(),
                createdBy: userName,
                x: current.x,
                y: current.y,
                rows,
                cols,
                cellWidth: 80,
                cellHeight: 40,
                stroke: color,
                cells: Array.from({ length: rows }, () =>
                    Array.from({ length: cols }, () => ({
                      value: '',
                      color: DEFAULT_CELL_COLOR,
                    })),
                ),
              }
              commitShape(
                  shape,
                  `${userName} created a ${shape.rows}x${shape.cols} table`,
              )
            }
          }
          return null
        })
      },
      [color, commitShape, userName],
  )

  const handleTableEditorChange = useCallback((key, value) => {
    setTableEditor((current) => (current ? { ...current, [key]: value } : current))
  }, [])

  const getPointerPosition = useCallback((clientX, clientY) => {
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

  const getRelativePoint = (event) => {
    const result = getPointerPosition(event.clientX, event.clientY)
    return result ? result.point : null
  }

  const handlePointerDown = (event) => {
    if (tool === 'move' || tool === 'resize') return

    if (tool === 'text' && textEditor) {
      finalizeTextEditor(true)
    }
    if (tool === 'text' && cellEditor) {
      finalizeCellEditor(true)
    }
    if (tool === 'table' && tableEditor) {
      finalizeTableEditor(true)
    }

    const point = getRelativePoint(event)
    if (!point) return

    if (tool === 'eraser') {
      const targetShape = findShapeAtPoint(point)
      if (!targetShape) return
      const description =
          targetShape.type === 'text'
              ? `${userName} erased text "${extractPlainText(targetShape.text)}"`
              : targetShape.type === 'table'
                  ? `${userName} erased a ${targetShape.rows}x${targetShape.cols} table`
                  : targetShape.type === 'path'
                      ? `${userName} erased a stroke`
                      : `${userName} erased a ${targetShape.type}`
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
        const cellValue =
            (shape.cells[row] && shape.cells[row][col] && shape.cells[row][col].value) ||
            ''
        const cellX = shape.x + col * shape.cellWidth
        const cellY = shape.y + row * shape.cellHeight
        setCellEditor({
          tableId: shape.id,
          row,
          col,
          x: cellX,
          y: cellY,
          width: shape.cellWidth,
          height: shape.cellHeight,
          value: normalizeHtmlContent(cellValue),
        })
        return
      }

      const existingText = findShapeAtPoint(point)
      if (existingText && existingText.type === 'text') {
        setTextEditor({
          id: existingText.id,
          shapeId: existingText.id,
          x: existingText.x,
          y: existingText.y,
          value: existingText.text,
          mode: 'edit',
          originalColor: existingText.color,
          fontSize: existingText.fontSize,
        })
        return
      }

      setTextEditor({
        id: randomId(),
        x: point.x,
        y: point.y,
        value: '',
        mode: 'create',
      })
      return
    }

    if (tool === 'table') {
      setTableEditor({
        id: randomId(),
        x: point.x,
        y: point.y,
        rows: 3,
        cols: 4,
      })
      return
    }

    if (tool === 'shapes') {
      setIsDrawingShape(true)
      setTempShape({ start: point, current: point })
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
  }

  const handleShapePointerDown = useCallback(
      (event, shape) => {
        if (tool !== 'move') return
        if (
            !shape ||
            (shape.type !== 'text' &&
                shape.type !== 'table' &&
                shape.type !== 'path' &&
                shape.type !== 'rectangle' &&
                shape.type !== 'circle' &&
                shape.type !== 'ellipse' &&
                shape.type !== 'line')
        ) {
          return
        }
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
      (event, shape) => {
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
    const target = (shapesRef.current || []).find((shape) => shape && shape.id === drag.id)
    draggingShapeRef.current = null
    if (
        !target ||
        (target.type !== 'text' &&
            target.type !== 'table' &&
            target.type !== 'path' &&
            target.type !== 'rectangle' &&
            target.type !== 'circle' &&
            target.type !== 'ellipse' &&
            target.type !== 'line')
    ) {
      return
    }
    const description =
        target.type === 'text'
            ? `${userName} moved text "${extractPlainText(target.text)}"`
            : target.type === 'table'
                ? `${userName} moved ${target.rows}x${target.cols} table`
                : target.type === 'path'
                    ? `${userName} moved a stroke`
                    : `${userName} moved a ${target.type}`
    applyShapeUpdate(target, description, { skipUndoSnapshot: true })
  }, [applyShapeUpdate, userName])

  const finalizeShapeResize = useCallback(() => {
    const resizeState = resizingShapeRef.current
    if (!resizeState) return
    const target = (shapesRef.current || []).find(
        (shape) => shape && shape.id === resizeState.id,
    )
    resizingShapeRef.current = null
    if (!target) return
    const description =
        target.type === 'text'
            ? `${userName} resized text "${extractPlainText(target.text)}"`
            : target.type === 'table'
                ? `${userName} resized ${target.rows}x${target.cols} table`
                : target.type === 'path'
                    ? `${userName} resized a stroke`
                    : `${userName} resized a ${target.type}`
    applyShapeUpdate(target, description, { skipUndoSnapshot: true })
  }, [applyShapeUpdate, userName])

  const handlePointerMove = (event) => {
    if (isDrawingShape && tempShape) {
      const point = getRelativePoint(event)
      if (!point) return
      autoScrollBoard(point)
      setTempShape((prev) => (prev ? { ...prev, current: point } : null))
      return
    }

    if (resizingShapeRef.current) {
      const position = getPointerPosition(event.clientX, event.clientY)
      if (!position) return
      autoScrollBoard(position.point)
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
            if (!shape || shape.id !== resizeState.id) return shape
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
                fontSize: clamp(
                    original.fontSize * scale,
                    MIN_TEXT_SIZE,
                    MAX_TEXT_SIZE,
                ),
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
            if (original.type === 'rectangle') {
              return {
                ...shape,
                width: Math.max(original.width * scaleX, MIN_RESIZE_DIMENSION),
                height: Math.max(original.height * scaleY, MIN_RESIZE_DIMENSION),
              }
            }
            if (original.type === 'circle') {
              const scale = Math.max(scaleX, scaleY)
              return {
                ...shape,
                r: Math.max(original.r * scale, MIN_RESIZE_DIMENSION / 2),
              }
            }
            if (original.type === 'ellipse') {
              return {
                ...shape,
                rx: Math.max(original.rx * scaleX, MIN_RESIZE_DIMENSION / 2),
                ry: Math.max(original.ry * scaleY, MIN_RESIZE_DIMENSION / 2),
              }
            }
            if (original.type === 'line') {
              const minX = resizeState.startBounds.minX
              const minY = resizeState.startBounds.minY
              const originalBounds = getShapeBounds(original)
              const scaleXLine = scaleX
              const scaleYLine = scaleY
              return {
                ...shape,
                x1: clamp(
                    minX + (original.x1 - originalBounds.minX) * scaleXLine,
                    0,
                    position.bounds.width,
                ),
                y1: clamp(
                    minY + (original.y1 - originalBounds.minY) * scaleYLine,
                    0,
                    position.bounds.height,
                ),
                x2: clamp(
                    minX + (original.x2 - originalBounds.minX) * scaleXLine,
                    0,
                    position.bounds.width,
                ),
                y2: clamp(
                    minY + (original.y2 - originalBounds.minY) * scaleYLine,
                    0,
                    position.bounds.height,
                ),
              }
            }
            return shape
          }),
      )
      return
    }

    if (draggingShapeRef.current) {
      const position = getPointerPosition(event.clientX, event.clientY)
      if (!position) return
      autoScrollBoard(position.point)
      const { id, size } = draggingShapeRef.current
      const offset = draggingShapeRef.current.offset
      const { point, bounds } = position

      setShapes((prev) =>
          prev.map((shape) => {
            if (!shape || shape.id !== id) return shape
            const nextX = point.x - offset.x
            const nextY = point.y - offset.y

            if (shape.type === 'table') {
              return {
                ...shape,
                x: nextX,
                y: nextY,
              }
            }
            if (shape.type === 'text') {
              return {
                ...shape,
                x: nextX,
                y: nextY,
              }
            }
            if (shape.type === 'path') {
              const targetMinX = clamp(nextX, 0, Math.max(bounds.width - size.width, 0))
              const targetMinY = clamp(
                  nextY,
                  0,
                  Math.max(bounds.height - size.height, 0),
              )
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
            if (shape.type === 'rectangle') {
              return {
                ...shape,
                x: nextX,
                y: nextY,
              }
            }
            if (shape.type === 'circle') {
              return {
                ...shape,
                cx: point.x - offset.x + size.width / 2,
                cy: point.y - offset.y + size.height / 2,
              }
            }
            if (shape.type === 'ellipse') {
              return {
                ...shape,
                cx: point.x - offset.x + size.width / 2,
                cy: point.y - offset.y + size.height / 2,
              }
            }
            if (shape.type === 'line') {
              const currentBounds = getShapeBounds(shape)
              const deltaX = nextX - currentBounds.minX
              const deltaY = nextY - currentBounds.minY
              return {
                ...shape,
                x1: shape.x1 + deltaX,
                y1: shape.y1 + deltaY,
                x2: shape.x2 + deltaX,
                y2: shape.y2 + deltaY,
              }
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

  const commitShapeGeometry = useCallback(
      (shape, description) => {
        saveStateForUndo()
        const historyEntry = pushHistory(description)
        setShapes((prev) => [...prev, shape])
        broadcast({
          kind: 'add-shape',
          shape,
          history: historyEntry,
          senderId: clientId,
        })
      },
      [broadcast, clientId, pushHistory, saveStateForUndo],
  )

  const handlePointerUp = (event) => {
    if (isDrawingShape && tempShape) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      const { start, current } = tempShape
      const minSize = 4
      const width = Math.abs(current.x - start.x)
      const height = Math.abs(current.y - start.y)

      if (width < minSize && height < minSize) {
        setIsDrawingShape(false)
        setTempShape(null)
        return
      }

      let shape
      const description = `${userName} drew a ${shapeType}`

      switch (shapeType) {
        case 'rectangle': {
          shape = {
            id: randomId(),
            type: 'rectangle',
            createdAt: getTimestamp(),
            createdBy: userName,
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            width: Math.max(width, minSize),
            height: Math.max(height, minSize),
            stroke: color,
            strokeWidth,
          }
          break
        }
        case 'circle': {
          const radius = Math.max(
              Math.sqrt(width * width + height * height) / 2,
              minSize / 2,
          )
          shape = {
            id: randomId(),
            type: 'circle',
            createdAt: getTimestamp(),
            createdBy: userName,
            cx: (start.x + current.x) / 2,
            cy: (start.y + current.y) / 2,
            r: radius,
            stroke: color,
            strokeWidth,
          }
          break
        }
        case 'ellipse': {
          shape = {
            id: randomId(),
            type: 'ellipse',
            createdAt: getTimestamp(),
            createdBy: userName,
            cx: (start.x + current.x) / 2,
            cy: (start.y + current.y) / 2,
            rx: Math.max(Math.abs(width) / 2, minSize / 2),
            ry: Math.max(Math.abs(height) / 2, minSize / 2),
            stroke: color,
            strokeWidth,
          }
          break
        }
        case 'line': {
          shape = {
            id: randomId(),
            type: 'line',
            createdAt: getTimestamp(),
            createdBy: userName,
            x1: start.x,
            y1: start.y,
            x2: current.x,
            y2: current.y,
            stroke: color,
            strokeWidth,
          }
          break
        }
        default:
          shape = null
      }

      if (shape) {
        commitShapeGeometry(shape, description)
      }
      setIsDrawingShape(false)
      setTempShape(null)
      return
    }

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
      (shapeId, description) => {
        saveStateForUndo()
        setShapes((prev) => prev.filter((shape) => shape && shape.id !== shapeId))
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

  const renderResizeOverlay = (shape) => {
    if (tool !== 'resize') return null
    if (!shape) return null
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

  const renderShape = (shape) => {
    if (!shape) return null
    let node = null

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
      case 'text': {
        const estimatedWidth = 300
        const estimatedHeight = 100
        node = (
            <foreignObject
                x={shape.x}
                y={shape.y - shape.fontSize * 0.8}
                width={estimatedWidth}
                height={estimatedHeight}
                className={`board-text ${tool === 'move' ? 'movable-shape' : ''}`}
                onPointerDown={
                  tool === 'move'
                      ? (event) => handleShapePointerDown(event, shape)
                      : undefined
                }
            >
              <div
                  style={{
                    color: shape.color,
                    fontSize: `${shape.fontSize}px`,
                    fontFamily: 'inherit',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    lineHeight: '1.2',
                    maxWidth: `${estimatedWidth}px`,
                  }}
                  dangerouslySetInnerHTML={{ __html: shape.text }}
              />
            </foreignObject>
        )
        break
      }
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
        const textNodes = []
        for (let row = 0; row < shape.rows; row += 1) {
          for (let col = 0; col < shape.cols; col += 1) {
            const cell = shape.cells[row] && shape.cells[row][col]
            const cellValue = cell && cell.value
            if (!cellValue) continue
            const cellColor = (cell && cell.color) || DEFAULT_CELL_COLOR
            const cellX = shape.x + col * shape.cellWidth
            const cellY = shape.y + row * shape.cellHeight
            const cellHtml = normalizeHtmlContent(cellValue)
            textNodes.push(
                <foreignObject
                    key={`cell-${row}-${col}`}
                    x={cellX}
                    y={cellY}
                    width={shape.cellWidth}
                    height={shape.cellHeight}
                    pointerEvents="none"
                >
                  <div
                      className="table-cell-html"
                      style={{ color: cellColor }}
                      dangerouslySetInnerHTML={{ __html: cellHtml }}
                  />
                </foreignObject>,
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
      case 'rectangle':
        node = (
            <rect
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                fill={shape.fill || 'transparent'}
                className={tool === 'move' ? 'movable-shape' : ''}
                onPointerDown={
                  tool === 'move'
                      ? (event) => handleShapePointerDown(event, shape)
                      : undefined
                }
            />
        )
        break
      case 'circle':
        node = (
            <circle
                cx={shape.cx}
                cy={shape.cy}
                r={shape.r}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                fill={shape.fill || 'transparent'}
                className={tool === 'move' ? 'movable-shape' : ''}
                onPointerDown={
                  tool === 'move'
                      ? (event) => handleShapePointerDown(event, shape)
                      : undefined
                }
            />
        )
        break
      case 'ellipse':
        node = (
            <ellipse
                cx={shape.cx}
                cy={shape.cy}
                rx={shape.rx}
                ry={shape.ry}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                fill={shape.fill || 'transparent'}
                className={tool === 'move' ? 'movable-shape' : ''}
                onPointerDown={
                  tool === 'move'
                      ? (event) => handleShapePointerDown(event, shape)
                      : undefined
                }
            />
        )
        break
      case 'line':
        node = (
            <line
                x1={shape.x1}
                y1={shape.y1}
                x2={shape.x2}
                y2={shape.y2}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                className={tool === 'move' ? 'movable-shape' : ''}
                onPointerDown={
                  tool === 'move'
                      ? (event) => handleShapePointerDown(event, shape)
                      : undefined
                }
            />
        )
        break
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
    shapes: 'Shapes',
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
                  onChange={(event) =>
                      setUserName(event.target.value.slice(0, 32))
                  }
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
              {['pen', 'text', 'table', 'shapes', 'move', 'resize', 'eraser'].map(
                  (item) => (
                      <button
                          key={item}
                          className={`tool-btn ${tool === item ? 'active' : ''}`}
                          onClick={() => handleToolChange(item)}
                      >
                        {item === 'pen' && '✏️ Pencil'}
                        {item === 'text' && '📝 Text'}
                        {item === 'table' && '📊 Table'}
                        {item === 'shapes' && '🔷 Shapes'}
                        {item === 'move' && '🤚 Move'}
                        {item === 'resize' && '📐 Resize'}
                        {item === 'eraser' && '🧽 Eraser'}
                      </button>
                  ),
              )}
            </div>

            {tool === 'shapes' && (
                <div className="control">
                  <label>Shape type</label>
                  <div className="shape-type-selector">
                    {['rectangle', 'circle', 'ellipse', 'line'].map((type) => (
                        <button
                            key={type}
                            className={`shape-type-btn ${
                                shapeType === type ? 'active' : ''
                            }`}
                            onClick={() => setShapeType(type)}
                        >
                          {type === 'rectangle' && '▭ Rectangle'}
                          {type === 'circle' && '○ Circle'}
                          {type === 'ellipse' && '⬭ Ellipse'}
                          {type === 'line' && '─ Line'}
                        </button>
                    ))}
                  </div>
                </div>
            )}

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
                  onChange={(event) =>
                      setStrokeWidth(Number(event.target.value))
                  }
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

            <button
                className="primary-btn"
                type="button"
                onClick={handleDownloadResult}
            >
              ⬇ Download PNG
            </button>

            <button className="danger-btn" onClick={clearBoard}>
              Clear board
            </button>
          </aside>

          <div className="board-wrapper" ref={boardWrapperRef}>
            <div
                ref={boardRef}
                className={`board ${tool === 'move' ? 'move-mode' : ''} ${
                    tool === 'resize' ? 'resize-mode' : ''
                } ${tool === 'eraser' ? 'eraser-mode' : ''} ${
                    tool === 'text' ? 'text-mode' : ''
                } ${tool === 'text' && textEditor ? 'text-editing' : ''}`}
                style={{
                  width: boardDimensions.width,
                  height: boardDimensions.height,
                  ...(tool === 'pen' ? { cursor: buildPencilCursor(color) } : null),
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
              <svg className="board-canvas" ref={boardSvgRef}>
                {shapes.map((shape) => renderShape(shape))}
                {isDrawing && tempPoints.length > 1 && (
                    <polyline
                        className="path-stroke preview"
                        points={tempPoints
                            .map((p) => `${p.x},${p.y}`)
                            .join(' ')}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                )}
                {isDrawingShape &&
                    tempShape &&
                    (() => {
                      const { start, current } = tempShape
                      const width = Math.abs(current.x - start.x)
                      const height = Math.abs(current.y - start.y)
                      switch (shapeType) {
                        case 'rectangle':
                          return (
                              <rect
                                  x={Math.min(start.x, current.x)}
                                  y={Math.min(start.y, current.y)}
                                  width={width}
                                  height={height}
                                  stroke={color}
                                  strokeWidth={strokeWidth}
                                  fill="transparent"
                                  strokeDasharray="4"
                                  opacity={0.7}
                              />
                          )
                        case 'circle': {
                          const radius =
                              Math.sqrt(width * width + height * height) / 2
                          return (
                              <circle
                                  cx={(start.x + current.x) / 2}
                                  cy={(start.y + current.y) / 2}
                                  r={radius}
                                  stroke={color}
                                  strokeWidth={strokeWidth}
                                  fill="transparent"
                                  strokeDasharray="4"
                                  opacity={0.7}
                              />
                          )
                        }
                        case 'ellipse':
                          return (
                              <ellipse
                                  cx={(start.x + current.x) / 2}
                                  cy={(start.y + current.y) / 2}
                                  rx={Math.abs(width) / 2}
                                  ry={Math.abs(height) / 2}
                                  stroke={color}
                                  strokeWidth={strokeWidth}
                                  fill="transparent"
                                  strokeDasharray="4"
                                  opacity={0.7}
                              />
                          )
                        case 'line':
                          return (
                              <line
                                  x1={start.x}
                                  y1={start.y}
                                  x2={current.x}
                                  y2={current.y}
                                  stroke={color}
                                  strokeWidth={strokeWidth}
                                  strokeDasharray="4"
                                  opacity={0.7}
                              />
                          )
                        default:
                          return null
                      }
                    })()}
              </svg>

              {textEditor && tool === 'text' && (
                  <RichTextEditor
                      ref={textInputRef}
                      value={textEditor.value}
                      onChange={handleTextEditorChange}
                      onBlur={() => finalizeTextEditor(true)}
                      onKeyDown={(event) => {
                        if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey
                        ) {
                          event.preventDefault()
                          finalizeTextEditor(true)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          finalizeTextEditor(false)
                        }
                      }}
                      style={{
                        left: textEditor.x,
                        top: Math.max(
                            textEditor.y - DEFAULT_FONT_SIZE * 1.2,
                            0,
                        ),
                      }}
                      placeholder="Type here."
                  />
              )}

              {cellEditor && tool === 'text' && (
                  <RichTextEditor
                      ref={cellInputRef}
                      variant="compact"
                      value={cellEditor.value}
                      onChange={handleCellEditorChange}
                      onBlur={() => finalizeCellEditor(true)}
                      onKeyDown={(event) => {
                        if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey
                        ) {
                          event.preventDefault()
                          finalizeCellEditor(true)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          finalizeCellEditor(false)
                        }
                      }}
                      style={{
                        left: cellEditor.x,
                        top: cellEditor.y,
                        width: Math.max(cellEditor.width, 220),
                        minWidth: Math.max(cellEditor.width, 220),
                      }}
                      placeholder="Cell text"
                  />
              )}

              {tableEditor && tool === 'table' && (
                  <div
                      className="table-editor"
                      style={{
                        left: tableEditor.x,
                        top: tableEditor.y,
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                  >
                    <label>
                      Rows
                      <input
                          ref={tableRowsRef}
                          type="number"
                          min={1}
                          max={12}
                          value={tableEditor.rows}
                          onChange={(event) =>
                              handleTableEditorChange(
                                  'rows',
                                  Number(event.target.value),
                              )
                          }
                      />
                    </label>
                    <label>
                      Columns
                      <input
                          type="number"
                          min={1}
                          max={12}
                          value={tableEditor.cols}
                          onChange={(event) =>
                              handleTableEditorChange(
                                  'cols',
                                  Number(event.target.value),
                              )
                          }
                      />
                    </label>
                    <div className="table-editor-actions">
                      <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => finalizeTableEditor(false)}
                      >
                        Cancel
                      </button>
                      <button
                          type="button"
                          className="primary-btn"
                          onClick={() => finalizeTableEditor(true)}
                      >
                        Create
                      </button>
                    </div>
                  </div>
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
                      window.alert(
                          'Open this dashboard in another tab to collaborate in real-time!',
                      )
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
                    <span className="history-time">
                  {formatTime(entry.timestamp)}
                </span>
                  </li>
              ))}
            </ul>
          </aside>
        </section>
      </div>
  )
}

export default App
