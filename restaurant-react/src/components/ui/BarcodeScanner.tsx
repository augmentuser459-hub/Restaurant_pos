import { useState, useRef, useEffect } from 'react'
import { Barcode, X, Search, Keyboard } from 'lucide-react'

interface BarcodeScannerProps {
  onScan: (barcode: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  value?: string
  onChange?: (value: string) => void
}

// USB scanners "type" the code very fast (< 50 ms between keys) and usually finish with Enter.
const SCANNER_THRESHOLD = 50 // milliseconds between keys
const MIN_SCAN_KEYS = 6 // a burst at least this long counts as a scan (people never type that fast)
const SCAN_IDLE_MS = 100 // scanners without an Enter suffix: submit after this pause

/**
 * BarcodeScanner Component
 * - Supports USB barcode scanners (keyboard input, with or without an Enter suffix)
 * - Supports manual barcode entry (Enter or the search button)
 * - Enter never submits the surrounding form
 */
export default function BarcodeScanner({
  onScan,
  placeholder = 'امسح الباركود أو أدخله يدوياً',
  className = '',
  disabled = false,
  value: externalValue,
  onChange: externalOnChange
}: BarcodeScannerProps) {
  const [internalBarcode, setInternalBarcode] = useState('')
  const barcode = externalValue !== undefined ? externalValue : internalBarcode
  const [isScanning, setIsScanning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Latest props/value for the scan timer (avoids stale closures and re-subscribing on every render)
  const onScanRef = useRef(onScan)
  const onChangeRef = useRef(externalOnChange)
  const valueRef = useRef(barcode)
  const lastKeyTimeRef = useRef(0)
  const fastKeysRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    onScanRef.current = onScan
    onChangeRef.current = externalOnChange
  })

  useEffect(() => {
    valueRef.current = barcode
  }, [barcode])

  // Clear the pending scan timer only when the component goes away
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const setBarcode = (value: string) => {
    valueRef.current = value
    if (onChangeRef.current) onChangeRef.current(value)
    else setInternalBarcode(value)
  }

  const clearTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const submit = (raw: string) => {
    clearTimer()
    fastKeysRef.current = 0
    setIsScanning(false)
    const code = raw.trim()
    if (!code) return
    // clear first: onScan may set the field again (or show a message) and must have the last word
    setBarcode('')
    onScanRef.current(code)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Scanners send Enter after every code: it must never submit the form this field sits in
      e.preventDefault()
      submit(e.currentTarget.value)
      return
    }
    if (e.key.length !== 1) return

    const now = Date.now()
    const isFast = now - lastKeyTimeRef.current < SCANNER_THRESHOLD
    lastKeyTimeRef.current = now
    fastKeysRef.current = isFast ? fastKeysRef.current + 1 : 0

    if (fastKeysRef.current >= MIN_SCAN_KEYS - 1) {
      setIsScanning(true)
      clearTimer()
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        submit(valueRef.current)
      }, SCAN_IDLE_MS)
    }
  }

  const handleManualSubmit = () => {
    submit(barcode)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBarcode(e.target.value)
  }

  const clearBarcode = () => {
    clearTimer()
    fastKeysRef.current = 0
    setIsScanning(false)
    setBarcode('')
    inputRef.current?.focus()
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Barcode className="w-5 h-5" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={barcode}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={`w-full pr-10 pl-10 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              isScanning ? 'border-green-500 bg-green-50' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
            dir="ltr"
            autoComplete="off"
          />
          {barcode && (
            <button
              type="button"
              onClick={clearBarcode}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="مسح"
              aria-label="مسح الباركود"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={disabled || barcode.trim().length === 0}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="بحث"
          aria-label="بحث بالباركود"
        >
          <Search className="w-5 h-5" />
        </button>
      </div>

      {/* Scanner status indicator */}
      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
        <Keyboard className="w-3 h-3" />
        <span>
          {isScanning ? (
            <span className="text-green-600 font-medium">جاري المسح...</span>
          ) : (
            'استخدم قارئ الباركود أو أدخل الرقم يدوياً'
          )}
        </span>
      </div>
    </div>
  )
}
