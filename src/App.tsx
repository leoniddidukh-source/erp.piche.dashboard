import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './contexts/ThemeContext'
import './App.css'

type Tool = 'pen' | 'text' | 'table'

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
}

type Shape = PathShape | TextShape | TableShape

type HistoryItem = {
  id: string
  timestamp: number
  user: string
  description: string
  shapeId?: string // Link to shape if this history item represents a shape addition
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
  | { kind: 'remove-history'; historyId: string; shapeId?: string; senderId: string }

const STORAGE_KEYS = {
  shapes: 'dashboard.whiteboard.shapes',
  history: 'dashboard.whiteboard.history',
  user: 'dashboard.whiteboard.user',
} as const

const randomId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11)

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

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

function App() {
  const { theme } = useTheme()
  const clientId = useMemo(() => randomId(), [])

  const [userName, setUserName] = useState(() => {
    const stored = loadFromStorage(STORAGE_KEYS.user, '')
    if (stored) return stored
    return `Guest-${Math.floor(Math.random() * 900 + 100)}`
  })

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#22d3ee')
  const [strokeWidth, setStrokeWidth] = useState(4)

  const [shapes, setShapes] = useState<Shape[]>(() =>
    loadFromStorage<Shape[]>(STORAGE_KEYS.shapes, []),
  )
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    loadFromStorage<HistoryItem[]>(STORAGE_KEYS.history, []),
  )

  const [isDrawing, setIsDrawing] = useState(false)
  const [tempPoints, setTempPoints] = useState<Point[]>([])
  const [textEditing, setTextEditing] = useState<{
    position: Point
    value: string
  } | null>(null)

  const boardRef = useRef<HTMLDivElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const shapesRef = useRef<Shape[]>(shapes)
  const historyRef = useRef<HistoryItem[]>(history)

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
    if (typeof window === 'undefined') return

    const channel = new BroadcastChannel('dashboard-whiteboard')
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<ChannelMessage>) => {
      const payload = event.data
      if (!payload || payload.senderId === clientId) return

      switch (payload.kind) {
        case 'add-shape':
          setShapes((prev) => [...prev, payload.shape])
          setHistory((prev) => [payload.history, ...prev])
          break
        case 'clear-board':
          setShapes([])
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
          setShapes(payload.shapes)
          setHistory(payload.history)
          break
        case 'remove-history':
          setHistory((prev) => prev.filter((item) => item.id !== payload.historyId))
          // If a shape is associated with this history item, remove it too
          if (payload.shapeId) {
            setShapes((prev) => prev.filter((shape) => shape.id !== payload.shapeId))
          }
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

  const pushHistory = useCallback(
    (description: string, userOverride?: string, shapeId?: string) => {
      const entry: HistoryItem = {
        id: randomId(),
        timestamp: Date.now(),
        user: userOverride ?? userName,
        description,
        shapeId,
      }
      setHistory((prev) => [entry, ...prev].slice(0, 250))
      return entry
    },
    [userName],
  )

  const commitShape = useCallback(
    (shape: Shape, description: string) => {
      const historyEntry = pushHistory(description, undefined, shape.id)
      setShapes((prev) => [...prev, shape])
      broadcast({
        kind: 'add-shape',
        shape,
        history: historyEntry,
        senderId: clientId,
      })
    },
    [broadcast, clientId, pushHistory],
  )

  const commitText = useCallback(
    (text: string, position: Point) => {
      if (!text.trim()) {
        setTextEditing(null)
        return
      }

      const shape: TextShape = {
        id: randomId(),
        type: 'text',
        createdAt: Date.now(),
        createdBy: userName,
        x: position.x,
        y: position.y,
        text: text.trim(),
        color,
      }

      commitShape(shape, `${userName} added text "${shape.text}"`)
      setTextEditing(null)
    },
    [color, commitShape, userName],
  )

  const cancelTextEditing = useCallback(() => {
    setTextEditing(null)
  }, [])

  useEffect(() => {
    if (textEditing && textInputRef.current) {
      textInputRef.current.focus()
    }
  }, [textEditing])

  const handleToolChange = useCallback(
    (newTool: Tool) => {
      // If switching away from text tool and text is being edited, commit or cancel it
      if (tool === 'text' && newTool !== 'text' && textEditing) {
        if (textEditing.value.trim()) {
          commitText(textEditing.value, textEditing.position)
        } else {
          cancelTextEditing()
        }
      }
      setTool(newTool)
    },
    [tool, textEditing, commitText, cancelTextEditing],
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
    // If clicking on the text input itself, don't handle it
    if ((event.target as HTMLElement).classList.contains('board-text-input')) {
      return
    }

    const point = getRelativePoint(event)
    if (!point) return

    // If text is being edited, commit or cancel it first, then don't start new action
    if (textEditing) {
      if (textEditing.value.trim()) {
        commitText(textEditing.value, textEditing.position)
      } else {
        cancelTextEditing()
      }
      // Don't start new action on the same click
      event.preventDefault()
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
      setTextEditing({
        position: point,
        value: '',
      })
      event.preventDefault()
      return
    }

    if (tool === 'table') {
      const rows = Number(window.prompt('How many rows? (1-12)', '3')) || 0
      const cols = Number(window.prompt('How many columns? (1-12)', '4')) || 0
      if (!rows || !cols) return

      const shape: TableShape = {
        id: randomId(),
        type: 'table',
        createdAt: Date.now(),
        createdBy: userName,
        x: point.x,
        y: point.y,
        rows: clamp(rows, 1, 12),
        cols: clamp(cols, 1, 12),
        cellWidth: 80,
        cellHeight: 40,
        stroke: color,
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
    const historyEntry = pushHistory(`${userName} cleared the board`)
    setShapes([])
    broadcast({
      kind: 'clear-board',
      history: historyEntry,
      senderId: clientId,
    })
  }

  const removeHistoryItem = useCallback(
    (historyId: string) => {
      // Find the history item to get its shapeId if it exists
      const historyItem = history.find((item) => item.id === historyId)
      
      // Remove from history
      setHistory((prev) => prev.filter((item) => item.id !== historyId))
      
      // If this history item is linked to a shape, remove that shape too
      if (historyItem?.shapeId) {
        setShapes((prev) => prev.filter((shape) => shape.id !== historyItem.shapeId))
      }
      
      broadcast({
        kind: 'remove-history',
        historyId,
        shapeId: historyItem?.shapeId,
        senderId: clientId,
      })
    },
    [broadcast, clientId, history],
  )

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
        return (
          <g key={shape.id} className="board-table">
            <rect
              x={shape.x}
              y={shape.y}
              width={width}
              height={height}
              fill={theme === 'light' ? 'rgba(241, 245, 249, 0.3)' : 'rgba(15, 23, 42, 0.25)'}
              stroke={shape.stroke}
              strokeWidth={1.5}
              rx={4}
            />
            {horizontal}
            {vertical}
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
        <div className="user-badge">
          <label htmlFor="userName">Display name</label>
          <input
            id="userName"
            value={userName}
            onChange={(event) => setUserName(event.target.value.slice(0, 32))}
            placeholder="Your name"
          />
        </div>
        <ThemeToggle />
      </header>

      <section className="content">
        <aside className="panel tool-panel">
          <p className="panel-title">Create</p>
          <div className="tool-grid">
            {(['pen', 'text', 'table'] as Tool[]).map((item) => (
              <button
                key={item}
                className={`tool-btn ${tool === item ? 'active' : ''}`}
                onClick={() => handleToolChange(item)}
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
            {textEditing && (
              <input
                ref={textInputRef}
                type="text"
                className="board-text-input"
                value={textEditing.value}
                onChange={(e) =>
                  setTextEditing({
                    ...textEditing,
                    value: e.target.value,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitText(textEditing.value, textEditing.position)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelTextEditing()
                  }
                }}
                onBlur={() => {
                  if (textEditing.value.trim()) {
                    commitText(textEditing.value, textEditing.position)
                  } else {
                    cancelTextEditing()
                  }
                }}
                style={{
                  left: `${textEditing.position.x}px`,
                  top: `${textEditing.position.y}px`,
                  color: color,
                }}
                placeholder="Type text here..."
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
              onClick={() => window.alert('Open this dashboard in another tab to collaborate in real-time!')}
            >
              Invite
            </button>
          </div>
          <ul className="history-list">
            {history.map((entry) => (
              <li key={entry.id} className="history-row">
                <div className="history-content">
                  <p className="history-description">{entry.description}</p>
                  <p className="history-user">{entry.user}</p>
                </div>
                <div className="history-actions">
                  <span className="history-time">{formatTime(entry.timestamp)}</span>
                  <button
                    className="history-delete-btn"
                    onClick={() => removeHistoryItem(entry.id)}
                    aria-label={`Remove ${entry.description}`}
                    title="Remove this action"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </div>
  )
}

export default App
