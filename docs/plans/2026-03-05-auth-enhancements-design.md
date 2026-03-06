# Auth Enhancements: Password Reset, Force Reset, Open Registration

## 1. Admin Password Reset
- Admin panel: "Reset Password" button per user
- Admin enters a new temporary password
- User's `force_password_reset` flag is automatically set to `1`

## 2. Force Password Reset
- New column `force_password_reset` on `users` table (integer, default 0)
- Set to `1` when: admin resets a password, or admin manually clicks "Force Reset"
- On login, if flag is `1`, redirect to `/reset-password` instead of requested page
- `/reset-password` page: new password + confirm (no current password needed since admin-triggered)
- Clears the flag on success, redirects to home

## 3. Open Registration (toggleable + optional approval)

### Settings
- New `app_settings` table: key-value store for global settings
  - `registration_enabled`: `'true'` / `'false'` (default `'false'`)
  - `registration_requires_approval`: `'true'` / `'false'` (default `'false'`)

### User Status
- New column `status` on `users` table: `'active'` | `'pending'` (default `'active'`)
- Existing users remain `'active'`

### Registration Flow
- Login page shows "Create Account" link when `registration_enabled` is `'true'`
- `/register` page: username, display name, password, confirm
- Creates user with status `'pending'` if approval required, `'active'` if not
- Pending users who log in see `/pending-approval` (static waiting screen)

### Admin Approval
- Admin panel: pending users section with Approve/Deny buttons
- Approve sets status to `'active'`
- Deny deletes the user

## Routes

| Route | Purpose |
|---|---|
| `/register` | Open registration form (gated by setting) |
| `/reset-password` | Forced password change |
| `/pending-approval` | Waiting screen for pending users |

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| PUT | `/api/admin/users/:id/reset-password` | Admin resets user password |
| PUT | `/api/admin/users/:id/force-reset` | Admin flags force reset |
| PUT | `/api/admin/users/:id/approve` | Approve pending user |
| DELETE | `/api/admin/users/:id/deny` | Deny pending user |
| GET | `/api/admin/settings` | Read app settings |
| PUT | `/api/admin/settings` | Write app settings |
