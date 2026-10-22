import { useState, useCallback } from 'react'
import type { PosSellableItem } from '../services/orders.service'
import { roundMoney } from '../lib/utils'

// Quantities are whole units (order_items.quantity is an integer); the server re-prices every line at checkout.
export interface CartItem {
  id: string
  item: PosSellableItem
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

  const addItem = useCallback((item: PosSellableItem) => {
    setItems(prev => {
      const existing = prev.find(i => i.item.item_id === item.item_id)
      if (existing) {
        return prev.map(i =>
          i.item.item_id === item.item_id
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
    const whole = Math.floor(quantity)
    if (whole <= 0) {
      setItems(prev => prev.filter(i => i.id !== itemId))
    } else {
      setItems(prev =>
        prev.map(i =>
          i.id === itemId ? { ...i, quantity: whole } : i
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

  // Replaces each line's item with its latest version (new price/stock); drops lines no longer sellable.
  // Returns the names of the dropped lines.
  const refreshItems = useCallback((latest: PosSellableItem[]): string[] => {
    const byId = new Map(latest.map(i => [i.item_id, i]))
    const removed = items.filter(i => !byId.has(i.item.item_id)).map(i => i.item.name_ar)
    setItems(prev =>
      prev
        .filter(i => byId.has(i.item.item_id))
        .map(i => ({ ...i, item: byId.get(i.item.item_id)! }))
    )
    return removed
  }, [items])

  const subtotal = roundMoney(items.reduce(
    (sum, item) => sum + roundMoney(item.item.price * item.quantity),
    0
  ))
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
    refreshItems,
  }
}
