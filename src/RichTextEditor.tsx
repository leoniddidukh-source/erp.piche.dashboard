import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import type React from 'react'
import './RichTextEditor.css'

const DEFAULT_TEXT_COLOR = '#ffffff'

const normalizeColor = (value: string | null): string => {
  if (!value) return DEFAULT_TEXT_COLOR
  const trimmed = value.trim().toLowerCase()
  if (trimmed.startsWith('rgb')) {
    const match = trimmed.match(/rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
    if (match) {
      const [, r, g, b] = match
      const toHex = (component: string) => {
        const num = Number(component)
        return Number.isFinite(num) ? num.toString(16).padStart(2, '0') : '00'
      }
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    }
  }
  if (trimmed === '' || trimmed === 'transparent') {
    return DEFAULT_TEXT_COLOR
  }
  return trimmed
}

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  style?: React.CSSProperties
  placeholder?: string
}

export interface RichTextEditorHandle {
  focus: () => void
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      value,
      onChange,
      onBlur,
      onKeyDown,
      style,
      placeholder = 'Type here...',
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null)
    const toolbarRef = useRef<HTMLDivElement>(null)
    const selectionRef = useRef<Range | null>(null)
    const ignoreBlurRef = useRef(false)
    const [currentColor, setCurrentColor] = useState(DEFAULT_TEXT_COLOR)

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus()
      },
    }))

    const isSelectionInsideEditor = useCallback(() => {
      if (typeof document === 'undefined') return false
      const selection = document.getSelection()
      if (!selection || selection.rangeCount === 0) return false
      const anchorNode = selection.anchorNode
      const focusNode = selection.focusNode
      if (!editorRef.current) return false
      return (
        !!anchorNode &&
        !!focusNode &&
        editorRef.current.contains(anchorNode) &&
        editorRef.current.contains(focusNode)
      )
    }, [])

    const readSelectionColor = useCallback(() => {
      if (typeof document === 'undefined') return DEFAULT_TEXT_COLOR
      const value = document.queryCommandValue('foreColor')
      return normalizeColor(typeof value === 'string' ? value : null)
    }, [])

    const applyColorToListAncestors = useCallback(
      (color: string) => {
        if (typeof document === 'undefined') return
        const selection = document.getSelection()
        if (!selection || selection.rangeCount === 0) return
        const nodes = [selection.anchorNode, selection.focusNode]
        nodes.forEach((node) => {
          let current: Node | null = node
          while (current && current !== editorRef.current) {
            if (current instanceof HTMLElement && current.tagName === 'LI') {
              current.style.color = color
            }
            current = current.parentElement ?? (current.parentNode as Element | null)
          }
        })
      },
      [],
    )

    const saveSelection = useCallback(() => {
      if (typeof document === 'undefined') return
      if (!isSelectionInsideEditor()) return
      const selection = document.getSelection()
      if (selection && selection.rangeCount > 0) {
        selectionRef.current = selection.getRangeAt(0)
        setCurrentColor(readSelectionColor())
      }
    }, [isSelectionInsideEditor, readSelectionColor])

    const restoreSelection = useCallback(() => {
      if (typeof document === 'undefined') return
      const selection = document.getSelection()
      const range = selectionRef.current
      if (!selection || !range) return
      if (!editorRef.current) return
      editorRef.current.focus()
      selection.removeAllRanges()
      selection.addRange(range)
    }, [])

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value
    }
  }, [value])

    const handleInput = useCallback(() => {
      if (editorRef.current) {
        onChange(editorRef.current.innerHTML)
      }
      saveSelection()
    }, [onChange, saveSelection])

    const applyTextColor = useCallback(
      (color: string) => {
        restoreSelection()
        editorRef.current?.focus()
        document.execCommand('foreColor', false, color)
        applyColorToListAncestors(color)
        editorRef.current?.focus()
        handleInput()
        saveSelection()
      },
      [applyColorToListAncestors, handleInput, restoreSelection, saveSelection],
    )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Handle keyboard shortcuts
      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'b':
            event.preventDefault()
            document.execCommand('bold', false)
            handleInput()
            return
          case 'i':
            event.preventDefault()
            document.execCommand('italic', false)
            handleInput()
            return
          case 'u':
            event.preventDefault()
            document.execCommand('underline', false)
            handleInput()
            return
        }
      }
      onKeyDown?.(event)
    },
    [onKeyDown, handleInput],
  )

  const applyFormat = useCallback(
    (command: string, value?: string) => {
      restoreSelection()
      editorRef.current?.focus()
      document.execCommand(command, false, value)
      editorRef.current?.focus()
      handleInput()
      saveSelection()
    },
    [handleInput, restoreSelection, saveSelection],
  )

  const isFormatActive = useCallback((command: string): boolean => {
    return document.queryCommandState(command)
  }, [])

    const handleToolbarPointerDown = useCallback(
      (
        event: React.MouseEvent | React.PointerEvent,
        options?: { persistBlur?: boolean; preventDefault?: boolean },
      ) => {
        if (options?.preventDefault ?? true) {
          event.preventDefault()
        }
        event.stopPropagation()
        ignoreBlurRef.current = true
        saveSelection()
        if (!options?.persistBlur) {
          requestAnimationFrame(() => {
            ignoreBlurRef.current = false
          })
        }
      },
      [saveSelection],
    )

    const releaseBlurGuard = useCallback(() => {
      ignoreBlurRef.current = false
    }, [])

    const handleEditorPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      ignoreBlurRef.current = false
      event.stopPropagation()
    }, [])

    const handleEditorBlur = useCallback(() => {
      if (ignoreBlurRef.current) return
      onBlur()
    }, [onBlur])

  return (
    <div className="rich-text-editor-wrapper" style={style}>
      <div
        ref={toolbarRef}
        className="rich-text-toolbar"
        onPointerDown={(event) => handleToolbarPointerDown(event)}
        onMouseDown={(event) => handleToolbarPointerDown(event)}
        onPointerUp={releaseBlurGuard}
        onMouseUp={releaseBlurGuard}
      >
        <button
          type="button"
          className={`toolbar-btn ${isFormatActive('bold') ? 'active' : ''}`}
          onClick={() => applyFormat('bold')}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`toolbar-btn ${isFormatActive('italic') ? 'active' : ''}`}
          onClick={() => applyFormat('italic')}
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={`toolbar-btn ${isFormatActive('underline') ? 'active' : ''}`}
          onClick={() => applyFormat('underline')}
          title="Underline (Ctrl+U)"
        >
          <u>U</u>
        </button>
        <div className="toolbar-divider" aria-hidden />
        <button
          type="button"
          className={`toolbar-btn ${isFormatActive('insertUnorderedList') ? 'active' : ''}`}
          onClick={() => applyFormat('insertUnorderedList')}
          title="Bulleted list"
        >
          ••
        </button>
        <button
          type="button"
          className={`toolbar-btn ${isFormatActive('insertOrderedList') ? 'active' : ''}`}
          onClick={() => applyFormat('insertOrderedList')}
          title="Numbered list"
        >
          1.
        </button>
        <div className="toolbar-divider" aria-hidden />
        <label
          className="toolbar-color"
          title="Text color"
          onPointerDown={(event) =>
            handleToolbarPointerDown(event, { persistBlur: true, preventDefault: false })
          }
          onMouseDown={(event) =>
            handleToolbarPointerDown(event, { persistBlur: true, preventDefault: false })
          }
        >
          <span className="color-swatch" style={{ backgroundColor: currentColor }} />
          <input
            type="color"
            className="toolbar-color-picker"
            value={currentColor}
            onChange={(event) => {
              const next = event.target.value || DEFAULT_TEXT_COLOR
              setCurrentColor(next)
              applyTextColor(next)
              setTimeout(() => {
                ignoreBlurRef.current = false
              }, 0)
            }}
            onBlur={() => {
              ignoreBlurRef.current = false
            }}
          />
        </label>
      </div>
      <div
        ref={editorRef}
        className="rich-text-editor"
        contentEditable
        onPointerDown={handleEditorPointerDown}
        onInput={handleInput}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        onFocus={restoreSelection}
        onBlur={handleEditorBlur}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        suppressContentEditableWarning
      />
    </div>
  )
  },
)

