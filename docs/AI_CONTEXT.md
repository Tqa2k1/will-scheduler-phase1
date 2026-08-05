# WHILL Scheduler AI Context

## Project Information

Name:
WHILL Scheduler

Purpose:
シフト管理・自動作成システム

Company:
パシフィック・クルー株式会社


## Technology Stack

Frontend:
- Next.js 14.2.5
- React 18.3.1
- TypeScript 5.5.4

Backend:
- Next.js App Router API Routes

Database:
- PostgreSQL
- Prisma 5.20.0

Authentication:
- NextAuth 4.24.7
- JWT Session
- bcrypt password hashing

Libraries:
- zod
- exceljs
- pdfkit
- nodemailer

Deployment:
- Vercel


# Project Structure

## Frontend

Main application:

src/app


Pages:

Dashboard:
src/app/dashboard/page.tsx

Employee Management:
src/app/employees/page.tsx

User Management:
src/app/users/page.tsx

Monthly Roster:
src/app/roster/page.tsx

Daily Schedule:
src/app/schedule/[date]/page.tsx

Task Management:
src/app/tasks/page.tsx


# Backend API

API location:

src/app/api


Important APIs:

Employee:
src/app/api/employees


User:
src/app/api/users


Schedule:
src/app/api/schedule


Automatic Assignment:
src/app/api/schedule/auto-assign


Roster:
src/app/api/roster


Export:
src/app/api/export


Export functions:

Excel:
- roster-excel
- schedule-excel

PDF:
- schedule-pdf


# Core Business Logic

Automatic schedule engine:

src/lib/autoAssign.ts


Daily roster:

src/lib/dailyRoster.ts


Time management:

src/lib/timeSlots.ts
src/lib/workTime.ts


Database:

src/lib/prisma.ts


Authentication:

src/lib/auth.ts


Email:

src/lib/mailer.ts


# Database Design

Main Prisma schema:

prisma/schema.prisma


Important models:


User:

Purpose:
Login account management

Fields:
- email
- passwordHash
- name
- role
- employeeId


User roles:

ADMIN:
Full system control


EMPLOYEE:
Normal employee account


Employee:

Purpose:
Employee master data

Contains:
- name
- employee role
- commute information
- working time
- personal constraints


MonthRoster:

Purpose:
Monthly schedule management


DailyAssignment:

Purpose:
Daily task assignment


Break:

Purpose:
Break time management


CartPosition:

Purpose:
Work position management

Examples:
- A
- B
- 全
- WHILL tasks


TaskRequirement:

Purpose:
Required staff count by task


RotationPattern:

Purpose:
Work rotation management


RosterAuditLog:

Purpose:
Record changes history


# Authentication System

Login:

src/app/login/page.tsx


NextAuth:

src/app/api/auth/[...nextauth]/route.ts


Auth logic:

src/lib/auth.ts


Middleware:

src/middleware.ts


Current authentication:

- Credentials Provider
- Email/password login
- bcrypt password encryption
- JWT session


JWT stores:

- user id
- role
- employeeId


# Protected Pages

Protected by middleware:

- /dashboard
- /employees
- /roster
- /schedule
- /tasks
- /users


# Security Status


Current:

✅ NextAuth JWT authentication

✅ bcrypt password hashing

✅ Protected pages

✅ User API permission checking


Current problems:

⚠️ Need review every API route

⚠️ EMPLOYEE should only access own information

⚠️ INC permission needs consistent rules

⚠️ Export APIs need permission protection


Important security files:

src/lib/auth.ts

src/middleware.ts

src/app/api


Security rules:

Before returning employee data:
- Always check session
- Check user role
- Do not expose unnecessary personal data


# User Role Design


ADMIN:

Permission:
- Manage users
- Manage employees
- Manage schedules
- Full access


INC:

Purpose:
Management staff

Expected permission:
- Manage schedules
- Manage employees

Need to implement consistently.


EMPLOYEE:

Permission:
- View own schedule
- View limited personal information

Should not view other employees data.


# Automatic Assignment System


Main file:

src/lib/autoAssign.ts


Required work types:


A:

Operating time:

05:00 - 26:00


B:

Operating time:

06:00 - 24:00


全:

Operating time:

05:00 - 25:00


Additional tasks:

- WHILL到着準備
- WHILL到着片づけ
- WHILL出発準備
- WHILL出発片づけ
- 事務時間


Scheduling rules:

1.
A/B/全 are 2-hour blocks.

2.
Do not assign more staff than required count.

3.
Break time must not overlap.

4.
Working over 4 hours requires break.

5.
Night shift starting 22:00 requires special break handling.

6.
Part-time employees mainly work A/B/全.

7.
Rotation assignment required.

8.
Preparation and cleanup should use same employees.

9.
Need support 1-3 hour rotation.

10.
明け番 requires 2 consecutive hours rest.


# Current Development Tasks


Priority 1:

Security improvement:

- Review all APIs
- Protect employee information
- Improve role permissions


Priority 2:

Auto assignment improvement:

- Rewrite autoAssign.ts
- Support new business rules
- Support WHILL tasks
- Improve break algorithm


Priority 3:

Email:

- Improve notification system
- Check delivery issues


# Development Rules For AI


When changing code:

1.
Do not remove existing functions without confirmation.


2.
Check prisma/schema.prisma before database changes.


3.
Check TypeScript errors after modification.


4.
Check API permission before exposing data.


5.
Explain changed files after coding.


6.
Update TODO.md after adding new tasks.


7.
Update CHANGELOG.md after completed changes.


# Important Files Summary


Authentication:
- src/lib/auth.ts
- src/middleware.ts


Database:
- prisma/schema.prisma


Auto Scheduling:
- src/lib/autoAssign.ts


API:
- src/app/api


Frontend:
- src/app


Components:
- src/components