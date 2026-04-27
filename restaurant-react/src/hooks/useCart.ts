import { useState, useCallback } from 'react'
import { MenuItem } from '../types/database.types'

export interface CartItem {
  id: string
  item: MenuItem
  quantity: number
  notes?: string
}

export interface CartState {
  items: CartItem[]
  subtotal: number
  tax: number
  total: number
}

// No tax - removed as per request
// const TAX_RATE = 0.14 // 14% VAT

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])

  const addItem = useCallback((item: MenuItem) => {
    setItems(prev => {
      const existing = prev.find(i => i.item.id === item.id)
      if (existing) {
        return prev.map(i =>
          i.item.id === item.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      }
      return [...prev, { id: crypto.randomUUID(), item, quantity: 1 }]
    })
  }, [])

  const removeItem = useCallback((itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId))
  }, [])

  const updateQuantity = useCallback((itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems(prev => prev.filter(i => i.id !== itemId))
    } else {
      setItems(prev =>
        prev.map(i =>
          i.id === itemId ? { ...i, quantity } : i
        )
      )
    }
  }, [])

  const updateNotes = useCallback((itemId: string, notes: string) => {
    setItems(prev =>
      prev.map(i =>
        i.id === itemId ? { ...i, notes } : i
      )
    )
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
  }, [])

  const subtotal = items.reduce(
    (sum, item) => sum + item.item.price * item.quantity,
    0
  )
  const tax = 0 // No tax
  const total = subtotal // Total = subtotal (no tax)

  return {
    items,
    subtotal,
    tax,
    total,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    addItem,
    removeItem,
    updateQuantity,
    updateNotes,
    clearCart,
  }
}
