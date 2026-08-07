import("dotenv/config");
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const id = process.argv[2];
if (!id) {
  console.error("Usage: node delete-order.mjs <order-id>");
  process.exit(2);
}

async function run() {
  try {
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) {
      console.log("Order not found", id);
      return;
    }
    await prisma.order.delete({ where: { id } });
    console.log("Deleted order", id);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
