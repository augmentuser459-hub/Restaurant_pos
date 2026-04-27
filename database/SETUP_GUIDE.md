# Supabase Database Setup Guide

## Prerequisites
- A Supabase account (sign up at https://supabase.com)
- The `schema.sql` file in this directory

## Step-by-Step Setup

### 1. Create a New Supabase Project
1. Go to https://app.supabase.com
2. Click "New Project"
3. Fill in:
   - Project name: `restaurant-management` (or your choice)
   - Database password: (save this securely)
   - Region: Choose closest to your location
4. Wait for the project to be created (2-3 minutes)

### 2. Run the Schema SQL
1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Open the `schema.sql` file from this directory
4. Copy ALL the content and paste it into the SQL Editor
5. Click **Run** (or press Ctrl+Enter)
6. Wait for completion - you should see "Success. No rows returned"

### 3. Get Your Supabase Credentials
1. Go to **Project Settings** (gear icon in sidebar)
2. Click **API** section
3. Copy these values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (the long string under "Project API keys")

### 4. Configure Your React App
1. Navigate to `restaurant-react` folder
2. Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env
   ```
3. Edit `.env` and add your credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

### 5. Create Your First Admin User
1. In Supabase dashboard, go to **Authentication** > **Users**
2. Click **Add User** > **Create new user**
3. Fill in:
   - Email: your admin email
   - Password: secure password
   - Auto Confirm User: ✓ (checked)
4. Click **Create User**
5. Copy the User UID (you'll need it next)

### 6. Insert Admin User Record
1. First, get the admin role ID:
   ```sql
   SELECT id FROM roles WHERE name = 'admin';
   ```
2. Copy the role ID, then insert your admin user:
   ```sql
   INSERT INTO users (
     employee_code, 
     username, 
     email, 
     password_hash, 
     full_name, 
     full_name_ar, 
     role_id, 
     status
   )
   VALUES (
     'EMP001',
     'admin',
     'your-email@example.com',
     'temp-password-hash',  -- You'll change this through Supabase Auth
     'Admin User',
     'مدير النظام',
     'paste-role-id-here',
     'active'
   );
   ```
   
Note: For Supabase, you should create users through the Auth panel, then link them to this table.

### 7. Create a Main Warehouse Branch
```sql
INSERT INTO branches (code, name, name_ar, is_main_warehouse, status)
VALUES (
  'MAIN',
  'Main Warehouse',
  'المخزن الرئيسي',
  true,
  'active'
);
```

### 8. Test Your Connection
1. Start your React app:
   ```bash
   cd restaurant-react
   npm install
   npm run dev
   ```
2. Open the app in your browser
3. Try logging in with your admin credentials

## What Was Created

The schema includes:
- ✅ 40+ tables for complete restaurant management
- ✅ Custom ENUM types for type safety
- ✅ All foreign key relationships
- ✅ Indexes for performance
- ✅ Automatic timestamp triggers
- ✅ Default seed data (units, damage reasons, roles)
- ✅ Advanced features: batch tracking, audit logs, alerts, sessions

## Troubleshooting

### "relation already exists" error
- Your database already has some tables
- Either drop them first or use a fresh Supabase project

### Can't login after setup
- Make sure you inserted the user record in step 6
- Check that the user ID matches the auth user ID
- Verify your .env file has correct credentials

### RLS policy errors
- Make sure you're logged in
- Check that your user has the correct role in the users table

## Next Steps

After setup, you can:
1. Create additional branches
2. Add categories and items
3. Set up suppliers
4. Configure menu items
5. Start using the POS system

## Need Help?

Check the Supabase documentation: https://supabase.com/docs
