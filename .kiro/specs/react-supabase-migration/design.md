# Design Document: React + Supabase Migration

## Overview

This design document outlines the architecture and implementation approach for migrating the Restaurant Management System from Django to React with Supabase. The new system will be a Single Page Application (SPA) with real-time capabilities, leveraging Supabase for authentication, database, and real-time subscriptions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      React Frontend                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Pages  │  │Components│  │  Hooks  │  │Services │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
│       │            │            │            │              │
│       └────────────┴────────────┴────────────┘              │
│                         │                                    │
│              ┌──────────┴──────────┐                        │
│              │   Supabase Client   │                        │
│              └──────────┬──────────┘                        │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      Supabase Backend                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Auth   │  │Database │  │Realtime │  │ Storage │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Project Structure

```
restaurant-react/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── ui/              # Base UI components (Button, Input, Card)
│   │   ├── layout/          # Layout components (Sidebar, Navbar)
│   │   └── forms/           # Form components
│   ├── pages/               # Page components
│   │   ├── auth/            # Login, Register
│   │   ├── dashboard/       # Dashboard
│   │   ├── branches/        # Branch management
│   │   ├── suppliers/       # Supplier management
│   │   ├── inventory/       # Inventory management
│   │   ├── transfers/       # Transfer management
│   │   ├── damages/         # Damage management
│   │   ├── pos/             # POS (Cashier, Kitchen)
│   │   ├── reports/         # Reports
│   │   └── settings/        # Settings
│   ├── hooks/               # Custom React hooks
│   │   ├── useAuth.ts       # Authentication hook
│   │   ├── useSupabase.ts   # Supabase query hooks
│   │   └── useRealtime.ts   # Real-time subscription hooks
│   ├── services/            # Business logic services
│   │   ├── auth.service.ts
│   │   ├── branches.service.ts
│   │   ├── suppliers.service.ts
│   │   ├── inventory.service.ts
│   │   ├── transfers.service.ts
│   │   ├── damages.service.ts
│   │   ├── orders.service.ts
│   │   └── reports.service.ts
│   ├── types/               # TypeScript type definitions
│   │   └── database.types.ts
│   ├── lib/                 # Utilities and configurations
│   │   ├── supabase.ts      # Supabase client
│   │   └── utils.ts         # Helper functions
│   ├── contexts/            # React contexts
│   │   ├── AuthContext.tsx
│   │   └── AppContext.tsx
│   ├── App.tsx
│   └── main.tsx
├── public/
├── .env
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

### Key Interfaces

```typescript
// Types for database entities
interface Branch {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  status: 'active' | 'inactive' | 'maintenance';
  is_main_warehouse: boolean;
}

interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string;
  current_balance: number;
  status: 'active' | 'inactive';
}

interface Item {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  unit: string;
  category_id: string;
  status: 'active' | 'inactive';
}

interface Inventory {
  id: string;
  branch_id: string;
  item_id: string;
  quantity: number;
  min_quantity: number;
}

interface Order {
  id: string;
  order_number: string;
  branch_id: string;
  total_amount: number;
  payment_method: 'cash' | 'visa' | 'instapay' | 'wallet';
  status: 'new' | 'paid' | 'in_kitchen' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
}

interface Transfer {
  id: string;
  transfer_number: string;
  from_branch_id: string;
  to_branch_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'received';
}

interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'warehouse_manager' | 'branch_supervisor' | 'chef' | 'cashier';
  branch_id?: string;
}
```

## Data Models

The existing PostgreSQL schema in Supabase will be used. Key tables:

- `branches` - Restaurant locations
- `suppliers` - Vendor information
- `items` - Inventory items
- `categories` - Item categories
- `inventory` - Stock levels per branch
- `inventory_transactions` - Stock movement logs
- `supplies` - Supplier deliveries
- `supply_items` - Delivery line items
- `transfers` - Inter-branch transfers
- `transfer_items` - Transfer line items
- `damages` - Damaged goods records
- `orders` - Customer orders
- `order_items` - Order line items
- `users` - System users
- `daily_inventory_counts` - Daily stock counts
- `purchase_requests` - Purchase requisitions
- `purchase_orders` - Purchase orders

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Authentication Session Validity
*For any* valid user credentials, authenticating should return a valid session with user data and role information.
**Validates: Requirements 2.1, 2.5**

### Property 2: Logout Clears Session
*For any* authenticated user, logging out should result in no active session and null user state.
**Validates: Requirements 2.3**

### Property 3: Protected Route Access Control
*For any* unauthenticated request to a protected route, the system should redirect to the login page.
**Validates: Requirements 2.4**

### Property 4: Role-Based Navigation
*For any* user role, the sidebar navigation should only display links that the role has permission to access.
**Validates: Requirements 3.2**

### Property 5: Branch CRUD Operations
*For any* valid branch data, creating, reading, updating operations should persist and retrieve data correctly from Supabase.
**Validates: Requirements 4.1, 4.2, 4.3**

### Property 6: Supplier Balance Initialization
*For any* newly created supplier, the initial current_balance should be zero.
**Validates: Requirements 5.2**

### Property 7: Supply Recording Consistency
*For any* recorded supply, the system should create supply record, supply_items, and update inventory quantities atomically.
**Validates: Requirements 5.3**

### Property 8: Payment Balance Update
*For any* payment made to a supplier, the supplier's current_balance should decrease by the payment amount.
**Validates: Requirements 5.4**

### Property 9: Low Stock Detection
*For any* inventory item where quantity < min_quantity, the item should be flagged as low stock.
**Validates: Requirements 6.3**

### Property 10: Inventory Transaction Logging
*For any* inventory quantity change, a corresponding record should be created in inventory_transactions.
**Validates: Requirements 6.4**

### Property 11: Transfer Status Flow
*For any* new transfer, the initial status should be 'pending', and status transitions should follow: pending → approved/rejected → received.
**Validates: Requirements 7.1, 7.2**

### Property 12: Transfer Inventory Update
*For any* received transfer, the source branch inventory should decrease and destination branch inventory should increase by the transferred quantities.
**Validates: Requirements 7.3**

### Property 13: Damage Approval Inventory Deduction
*For any* approved damage record, the inventory quantity should decrease by the damaged amount.
**Validates: Requirements 8.2**

### Property 14: Cart Total Calculation
*For any* cart with items, the total should equal the sum of (item_price × quantity) for all items.
**Validates: Requirements 9.2**

### Property 15: Order Creation on Payment
*For any* completed payment, an order record should be created with status 'paid' and correct payment_method.
**Validates: Requirements 9.3, 9.5**

### Property 16: Kitchen Order Display
*For any* order with status 'in_kitchen' or 'preparing', it should appear in the kitchen display.
**Validates: Requirements 10.1**

### Property 17: Sales Report Aggregation
*For any* date range, the sales report total should equal the sum of all order totals within that range.
**Validates: Requirements 11.1**

### Property 18: Consumption Calculation
*For any* daily inventory count, consumption should equal: opening_quantity + incoming - closing_quantity.
**Validates: Requirements 12.2**

### Property 19: Purchase Request Number Uniqueness
*For any* created purchase request, the request_number should be unique across all requests.
**Validates: Requirements 13.1**

### Property 20: Number Locale Formatting
*For any* numeric value displayed, it should be formatted according to Arabic locale (ar-EG).
**Validates: Requirements 15.4**

## Error Handling

### Client-Side Errors
- Form validation errors displayed inline
- Network errors shown as toast notifications
- Session expiry triggers re-authentication

### Server-Side Errors
- Supabase errors caught and displayed to user
- Database constraint violations handled gracefully
- RLS policy violations return appropriate messages

## Testing Strategy

### Unit Testing
- Jest for unit tests
- React Testing Library for component tests
- Test individual services and hooks

### Property-Based Testing
- Use fast-check library for property-based tests
- Test data transformations and calculations
- Verify business logic invariants

### Integration Testing
- Test Supabase client operations
- Verify real-time subscriptions
- Test authentication flows

### Test Configuration
- Minimum 100 iterations for property tests
- Use test database or mock Supabase client
- Each property test tagged with requirement reference
