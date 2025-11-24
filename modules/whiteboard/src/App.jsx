import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './App.css';

const STORAGE_KEYS = {
  shapes: 'dashboard.whiteboard.shapes',
  history: 'dashboard.whiteboard.history',
  user: 'dashboard.whiteboard.user',
};

const TOOLS = ['pen', 'text', 'table'];

const randomId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11);
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const loadFromStorage = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to read ${key} from storage`, error);
    return fallback;
  }
};

const saveToStorage = (key, value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key} in storage`, error);
  }
};

const formatTime = (timestamp) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);

const App = () => {
  const clientId = useMemo(() => randomId(), []);

  const [userName, setUserName] = useState(() => {
    const stored = loadFromStorage(STORAGE_KEYS.user, '');
    if (stored) return stored;
    return `Guest-${Math.floor(Math.random() * 900 + 100)}`;
  });

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#22d3ee');
  const [strokeWidth, setStrokeWidth] = useState(4);

  const [shapes, setShapes] = useState(() =>
    loadFromStorage(STORAGE_KEYS.shapes, []),
  );
  const [history, setHistory] = useState(() =>
    loadFromStorage(STORAGE_KEYS.history, []),
  );

  const [isDrawing, setIsDrawing] = useState(false);
  const [tempPoints, setTempPoints] = useState([]);

  const boardRef = useRef(null);
  const channelRef = useRef(null);
  const shapesRef = useRef(shapes);
  const historyRef = useRef(history);

  useEffect(() => {
    shapesRef.current = shapes;
    saveToStorage(STORAGE_KEYS.shapes, shapes);
  }, [shapes]);

  useEffect(() => {
    historyRef.current = history;
    saveToStorage(STORAGE_KEYS.history, history);
  }, [history]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.user, userName);
  }, [userName]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.BroadcastChannel === 'undefined'
    ) {
      return;
    }

    const channel = new BroadcastChannel('dashboard-whiteboard');
    channelRef.current = channel;

    const handleMessage = (event) => {
      const payload = event.data;
      if (!payload || payload.senderId === clientId) return;

      switch (payload.kind) {
        case 'add-shape':
          setShapes((prev) => [...prev, payload.shape]);
          setHistory((prev) => [payload.history, ...prev]);
          break;
        case 'clear-board':
          setShapes([]);
          setHistory((prev) => [payload.history, ...prev]);
          break;
        case 'sync-request':
          if (!shapesRef.current.length && !historyRef.current.length) return;
          channel.postMessage({
            kind: 'sync-state',
            shapes: shapesRef.current,
            history: historyRef.current,
            senderId: clientId,
          });
          break;
        case 'sync-state':
          setShapes(payload.shapes);
          setHistory(payload.history);
          break;
        default:
          break;
      }
    };

    channel.addEventListener('message', handleMessage);
    channel.postMessage({ kind: 'sync-request', senderId: clientId });

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [clientId]);

  const broadcast = useCallback((message) => {
    channelRef.current?.postMessage(message);
  }, []);

  const pushHistory = useCallback(
    (description, userOverride) => {
      const entry = {
        id: randomId(),
        timestamp: Date.now(),
        user: userOverride || userName,
        description,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 250));
      return entry;
    },
    [userName],
  );

  const commitShape = useCallback(
    (shape, description) => {
      const historyEntry = pushHistory(description);
      setShapes((prev) => [...prev, shape]);
      broadcast({
        kind: 'add-shape',
        shape,
        history: historyEntry,
        senderId: clientId,
      });
    },
    [broadcast, clientId, pushHistory],
  );

  const commitPath = useCallback(
    (points) => {
      if (points.length < 2) return;
      const shape = {
        id: randomId(),
        type: 'path',
        createdAt: Date.now(),
        createdBy: userName,
        points,
        stroke: color,
        strokeWidth,
      };
      commitShape(shape, `${userName} drew a stroke (${points.length} pts)`);
    },
    [color, commitShape, strokeWidth, userName],
  );

  const getRelativePoint = (event) => {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  };

  const handlePointerDown = (event) => {
    const point = getRelativePoint(event);
    if (!point) return;

    if (tool === 'pen') {
      setTempPoints([point]);
      setIsDrawing(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Text to place on the board?');
      if (!text?.trim()) return;

      const shape = {
        id: randomId(),
        type: 'text',
        createdAt: Date.now(),
        createdBy: userName,
        x: point.x,
        y: point.y,
        text: text.trim(),
        color,
      };

      commitShape(shape, `${userName} added text "${shape.text}"`);
      return;
    }

    if (tool === 'table') {
      const rows = Number(window.prompt('How many rows? (1-12)', '3')) || 0;
      const cols = Number(window.prompt('How many columns? (1-12)', '4')) || 0;
      if (!rows || !cols) return;

      const shape = {
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
      };

      commitShape(
        shape,
        `${userName} created a ${shape.rows}x${shape.cols} table`,
      );
    }
  };

  const handlePointerMove = (event) => {
    if (!isDrawing || tool !== 'pen') return;
    const point = getRelativePoint(event);
    if (!point) return;
    setTempPoints((prev) => [...prev, point]);
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    if (tempPoints.length >= 2) {
      commitPath(tempPoints);
    }
    setTempPoints([]);
    setIsDrawing(false);
  };

  const clearBoard = () => {
    if (!shapes.length) return;
    const historyEntry = pushHistory(`${userName} cleared the board`);
    setShapes([]);
    broadcast({
      kind: 'clear-board',
      history: historyEntry,
      senderId: clientId,
    });
  };

  const renderShape = (shape) => {
    if (shape.type === 'path') {
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
      );
    }

    if (shape.type === 'text') {
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
      );
    }

    if (shape.type === 'table') {
      const width = shape.cols * shape.cellWidth;
      const height = shape.rows * shape.cellHeight;
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
      ));
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
      ));

      return (
        <g key={shape.id} className="board-table">
          <rect
            x={shape.x}
            y={shape.y}
            width={width}
            height={height}
            fill="rgba(15,23,42,0.25)"
            stroke={shape.stroke}
            strokeWidth={1.5}
            rx={4}
          />
          {horizontal}
          {vertical}
        </g>
      );
    }

    return null;
  };

  const activeToolLabel = {
    pen: 'Drawing',
    text: 'Text',
    table: 'Table',
  }[tool];

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
      </header>

      <section className="content">
        <aside className="panel tool-panel">
          <p className="panel-title">Create</p>
          <div className="tool-grid">
            {TOOLS.map((item) => (
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
  );
};

export default App;

