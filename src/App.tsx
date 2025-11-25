import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import './App.css'

type Tool = 'pen' | 'text' | 'table'
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
  return shape
}

const normalizeShapes = (shapes: Shape[]) => shapes.map(normalizeShape)

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

  const boardRef = useRef<HTMLDivElement | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const shapesRef = useRef<Shape[]>(shapes)
  const historyRef = useRef<HistoryItem[]>(history)
  const undoStackRef = useRef<Array<{ shapes: Shape[]; history: HistoryItem[] }>>([])
  const redoStackRef = useRef<Array<{ shapes: Shape[]; history: HistoryItem[] }>>([])
  const isUndoRedoRef = useRef(false)

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
    const payload = {
      generatedAt: new Date().toISOString(),
      generatedBy: userName,
      shapes: shapesRef.current,
      history: historyRef.current,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    link.href = url
    link.download = `whiteboard-${timestamp}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [userName])

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
        timestamp: Date.now(),
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
    (updatedShape: Shape, description: string) => {
      saveStateForUndo()
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
        createdAt: Date.now(),
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

  const getRelativePoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const board = boardRef.current
    if (!board) return null
    const rect = board.getBoundingClientRect()
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = getRelativePoint(event)
    if (!point) return

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

      const text = window.prompt('Text to place on the board?')
      if (!text?.trim()) return

      const shape: TextShape = {
        id: randomId(),
        type: 'text',
        createdAt: Date.now(),
        createdBy: userName,
        x: point.x,
        y: point.y,
        text: text.trim(),
        color,
      }

      commitShape(shape, `${userName} added text "${shape.text}"`)
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
        createdAt: Date.now(),
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

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || tool !== 'pen') return
    const point = getRelativePoint(event)
    if (!point) return
    setTempPoints((prev) => [...prev, point])
  }

  const handlePointerUp = () => {
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

  const renderShape = (shape: Shape) => {
    switch (shape.type) {
      case 'path':
        return (
          <polyline
            key={shape.id}
            className="path-stroke"
            points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={0.85}
          />
        )
      case 'text':
        return (
          <text
            key={shape.id}
            x={shape.x}
            y={shape.y}
            fill={shape.color}
            className="board-text"
          >
            {shape.text}
          </text>
        )
      case 'table': {
        const width = shape.cols * shape.cellWidth
        const height = shape.rows * shape.cellHeight
        const horizontal = Array.from({ length: shape.rows - 1 }, (_, row) => (
          <line
            key={`${shape.id}-h-${row}`}
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
            key={`${shape.id}-v-${col}`}
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
                key={`${shape.id}-cell-${row}-${col}`}
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
        return (
          <g key={shape.id} className="board-table">
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
      }
      default:
        return null
    }
  }

  const activeToolLabel = {
    pen: 'Drawing',
    text: 'Text',
    table: 'Table',
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
            {(['pen', 'text', 'table'] as Tool[]).map((item) => (
              <button
                key={item}
                className={`tool-btn ${tool === item ? 'active' : ''}`}
                onClick={() => setTool(item)}
              >
                {item === 'pen' && '✏️ Stroke'}
                {item === 'text' && '📝 Text'}
                {item === 'table' && '📊 Table'}
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
            <label>Stroke width: {strokeWidth}px</label>
            <input
              type="range"
              min={2}
              max={12}
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
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
            ⬇ Download result
          </button>

          <button className="danger-btn" onClick={clearBoard}>
            Clear board
          </button>
        </aside>

        <div className="board-wrapper">
          <div
            ref={boardRef}
            className="board"
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
