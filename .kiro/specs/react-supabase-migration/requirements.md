# Requirements Document

## Introduction

This document outlines the requirements for migrating the Restaurant Management System from Django (Python) with PostgreSQL to a modern React frontend with Supabase backend. The migration will preserve all existing functionality while leveraging Supabase's real-time capabilities, authentication, and serverless architecture.

## Glossary

- **Supabase**: Backend-as-a-Service platform providing PostgreSQL database, authentication, real-time subscriptions, and storage
- **React**: JavaScript library for building user interfaces
- **Vite**: Modern frontend build tool for React applications
- **RLS (Row Level Security)**: Supabase feature for database-level access control
- **Real-time**: Live data synchronization between clients and database

## Requirements

### Requirement 1: Project Setup and Configuration

**User Story:** As a developer, I want to set up a React project with Supabase integration, so that I can build the restaurant management system with modern tools.

#### Acceptance Criteria

1. WHEN the project is initialized THEN the system SHALL create a Vite-based React project with TypeScript support
2. WHEN Supabase client is configured THEN the system SHALL connect to the provided Supabase instance using environment variables
3. WHEN the project structure is created THEN the system SHALL organize code into logical folders (components, pages, services, hooks, types)
4. WHEN dependencies are installed THEN the system SHALL include React Router, Supabase client, and Tailwind CSS

### Requirement 2: Authentication System

**User Story:** As a user, I want to log in to the system securely, so that I can access features based on my role.

#### Acceptance Criteria

1. WHEN a user submits valid credentials THEN the system SHALL authenticate using Supabase Auth and create a session
2. WHEN a user is authenticated THEN the system SHALL store the session and redirect to the dashboard
3. WHEN a user logs out THEN the system SHALL clear the session and redirect to the login page
4. WHEN an unauthenticated user tries to access protected routes THEN the system SHALL redirect to the login page
5. WHEN a user's role is retrieved THEN the system SHALL fetch it from the users table and store in context

### Requirement 3: Dashboard and Navigation

**User Story:** As a user, I want to see a dashboard with relevant information and navigate easily, so that I can access system features quickly.

#### Acceptance Criteria

1. WHEN the dashboard loads THEN the system SHALL display summary statistics (total sales, pending transfers, low stock items)
2. WHEN the sidebar is rendered THEN the system SHALL show navigation links based on user role
3. WHEN a navigation link is clicked THEN the system SHALL route to the corresponding page without full page reload
4. WHEN the user is on mobile THEN the system SHALL provide a responsive sidebar that can be toggled

### Requirement 4: Branches Management

**User Story:** As a warehouse manager, I want to manage branches, so that I can organize the restaurant locations.

#### Acceptance Criteria

1. WHEN the branches list is requested THEN the system SHALL fetch and display all branches from Supabase
2. WHEN a new branch is created THEN the system SHALL insert the record into the branches table
3. WHEN a branch is updated THEN the system SHALL update the corresponding record in Supabase
4. WHEN a branch is deleted THEN the system SHALL remove the record if no related data exists

### Requirement 5: Suppliers Management

**User Story:** As a warehouse manager, I want to manage suppliers and their supplies, so that I can track inventory sources.

#### Acceptance Criteria

1. WHEN the suppliers list is requested THEN the system SHALL fetch and display all suppliers with their balance
2. WHEN a new supplier is created THEN the system SHALL insert the record with initial balance of zero
3. WHEN a supply is recorded THEN the system SHALL create supply and supply_items records and update inventory
4. WHEN a payment is made THEN the system SHALL record the payment and update supplier balance
5. WHEN supplier returns are processed THEN the system SHALL update inventory and supplier balance accordingly

### Requirement 6: Inventory Management

**User Story:** As a warehouse manager, I want to manage inventory items and stock levels, so that I can track available quantities.

#### Acceptance Criteria

1. WHEN the inventory list is requested THEN the system SHALL display items with current quantities and status
2. WHEN a new item is created THEN the system SHALL insert the record into the items table
3. WHEN stock falls below minimum THEN the system SHALL highlight the item as low stock
4. WHEN inventory is updated THEN the system SHALL log the transaction in inventory_transactions table

### Requirement 7: Transfers Management

**User Story:** As a branch supervisor, I want to request and receive inventory transfers, so that I can maintain stock levels.

#### Acceptance Criteria

1. WHEN a transfer is requested THEN the system SHALL create a transfer record with pending status
2. WHEN a transfer is approved THEN the system SHALL update status and set approved quantities
3. WHEN a transfer is received THEN the system SHALL update inventory for both branches
4. WHEN transfers are listed THEN the system SHALL show status with color indicators

### Requirement 8: Damages Management

**User Story:** As a branch supervisor, I want to record damaged items, so that inventory reflects actual usable stock.

#### Acceptance Criteria

1. WHEN damage is recorded THEN the system SHALL create a damage record with pending status
2. WHEN damage is approved THEN the system SHALL deduct quantity from inventory
3. WHEN damage is rejected THEN the system SHALL update status and record rejection reason
4. WHEN damages are listed THEN the system SHALL show all records with approval status

### Requirement 9: POS System - Cashier

**User Story:** As a cashier, I want to create and process orders, so that customers can purchase items.

#### Acceptance Criteria

1. WHEN the POS cashier screen loads THEN the system SHALL display menu items in a grid layout
2. WHEN an item is added to cart THEN the system SHALL update the order total in real-time
3. WHEN payment is processed THEN the system SHALL create order record and send to kitchen
4. WHEN an order is cancelled THEN the system SHALL update status and refund if paid
5. WHEN payment method is selected THEN the system SHALL record the method (cash/visa/instapay/wallet)

### Requirement 10: POS System - Kitchen

**User Story:** As a chef, I want to see incoming orders and update their status, so that I can prepare food efficiently.

#### Acceptance Criteria

1. WHEN the kitchen screen loads THEN the system SHALL display pending orders in real-time
2. WHEN a new order arrives THEN the system SHALL show it immediately using Supabase real-time subscription
3. WHEN order status is updated THEN the system SHALL reflect the change across all connected clients
4. WHEN an order is marked ready THEN the system SHALL notify the cashier screen

### Requirement 11: Reports

**User Story:** As a manager, I want to view reports, so that I can make informed business decisions.

#### Acceptance Criteria

1. WHEN sales report is requested THEN the system SHALL aggregate order data by date range
2. WHEN inventory report is requested THEN the system SHALL show stock levels and movements
3. WHEN supplier report is requested THEN the system SHALL display balances and transaction history
4. WHEN reports are generated THEN the system SHALL allow filtering by date range and branch

### Requirement 12: Daily Inventory Count (Chef Consumption)

**User Story:** As a branch supervisor, I want to record daily inventory counts, so that I can track consumption.

#### Acceptance Criteria

1. WHEN opening count is recorded THEN the system SHALL save quantities at start of day
2. WHEN closing count is recorded THEN the system SHALL calculate consumption automatically
3. WHEN counts are compared THEN the system SHALL highlight variances
4. WHEN count is approved THEN the system SHALL update inventory records

### Requirement 13: Purchase Manager

**User Story:** As a purchase manager, I want to create purchase requests and orders, so that I can manage procurement.

#### Acceptance Criteria

1. WHEN a purchase request is created THEN the system SHALL generate a unique request number
2. WHEN a request is approved THEN the system SHALL allow conversion to purchase order
3. WHEN a purchase order is created THEN the system SHALL link to supplier and track delivery
4. WHEN goods are received THEN the system SHALL update inventory and order status

### Requirement 14: Real-time Updates

**User Story:** As a user, I want to see live updates, so that I always have current information.

#### Acceptance Criteria

1. WHEN data changes in the database THEN the system SHALL push updates to subscribed clients
2. WHEN POS kitchen receives new order THEN the system SHALL display it within 1 second
3. WHEN inventory is updated THEN the system SHALL reflect changes on dashboard immediately
4. WHEN multiple users are connected THEN the system SHALL synchronize state across all clients

### Requirement 15: Arabic Language Support (RTL)

**User Story:** As an Arabic-speaking user, I want the interface in Arabic with RTL layout, so that I can use the system comfortably.

#### Acceptance Criteria

1. WHEN the application loads THEN the system SHALL render with RTL direction
2. WHEN text is displayed THEN the system SHALL use Arabic labels and messages
3. WHEN forms are rendered THEN the system SHALL align inputs for RTL reading
4. WHEN numbers are displayed THEN the system SHALL format according to locale
