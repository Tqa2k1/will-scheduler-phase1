import { PrismaClient } from "@prisma/client";

// Tránh tạo nhiều PrismaClient khi Next.js hot-reload lúc dev
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
