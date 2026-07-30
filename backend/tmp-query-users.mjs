import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, isAdmin: true, cedula: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(JSON.stringify(users, null, 2));
} finally {
  await prisma.$disconnect();
}
