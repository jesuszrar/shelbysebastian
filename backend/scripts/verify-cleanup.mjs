import("dotenv/config");
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count({ where: { OR: [ { email: { contains: "test+" } }, { email: { contains: "dbg" } } ] } });
  const orders = await prisma.order.count({ where: { OR: [ { customerEmail: { contains: "test+" } }, { shipping_email: { contains: "test+" } }, { shipping_name: { contains: "Tester" } } ] } });
  const addresses = await prisma.userAddress.count({ where: { OR: [ { fullName: { contains: "Dbg" } }, { label: { contains: "Casa" } } ] } });

  console.log(`users remaining: ${users}`);
  console.log(`orders remaining: ${orders}`);
  console.log(`addresses remaining: ${addresses}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});