import { useState, useRef, useEffect, useCallback } from 'react'
import { Barcode, X, Search, Keyboard } from 'lucide-react'

interface BarcodeScannerProps {
  onScan: (barcode: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  value?: string
  onChange?: (value: string) => void
}

/**
 * BarcodeScanner Component
 * - Supports USB barcode scanners (keyboard input)
 * - Supports manual barcode entry
 * - Auto-detects rapid input from scanner vs manual typing
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
  const setBarcode = externalOnChange || setInternalBarcode
  
  const [isScanning, setIsScanning] = useState(false)
  const [lastKeyTime, setLastKeyTime] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const bufferRef = useRef('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // USB Scanner detection: scanners type very fast (< 50ms between keys)
  const SCANNER_THRESHOLD = 50 // milliseconds

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Only process if input is focused or scanning mode is active
    if (document.activeElement !== inputRef.current && !isScanning) return

    const now = Date.now()
    const timeDiff = now - lastKeyTime
    setLastKeyTime(now)

    // If Enter key and we have a buffer, process it
    if (e.key === 'Enter' && bufferRef.current.length > 0) {
      e.preventDefault()
      const scannedBarcode = bufferRef.current.trim()
      if (scannedBarcode.length >= 3) {
        onScan(scannedBarcode)
        setBarcode('')
        bufferRef.current = ''
      }
      return
    }

    // Detect if this is scanner input (rapid typing)
    if (timeDiff < SCANNER_THRESHOLD && e.key.length === 1) {
      setIsScanning(true)
      bufferRef.current += e.key

      // Clear timeout and set new one
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setIsScanning(false)
        if (bufferRef.current.length >= 3) {
          onScan(bufferRef.current.trim())
          setBarcode('')
        }
        bufferRef.current = ''
      }, 100)
    }
  }, [lastKeyTime, isScanning, onScan])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [handleKeyDown])

  const handleManualSubmit = () => {
    if (barcode.trim().length >= 3) {
      onScan(barcode.trim())
      setBarcode('')
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBarcode(e.target.value)
    bufferRef.current = e.target.value
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleManualSubmit()
    }
  }

  const clearBarcode = () => {
    setBarcode('')
    bufferRef.current = ''
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
            onKeyPress={handleKeyPress}
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
          disabled={disabled || barcode.trim().length < 3}
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
