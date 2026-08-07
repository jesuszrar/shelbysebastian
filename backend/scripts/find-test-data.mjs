import("dotenv/config");
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const testUsers = await prisma.user.findMany({ where: { email: { contains: "test+" }, }, });
  console.log(`Found ${testUsers.length} test users:`);
  testUsers.forEach((u) => console.log(`- ${u.id} ${u.email}`));

  const userIds = testUsers.map((u) => u.id);
  const orders = await prisma.order.findMany({ where: { OR: [ { customerEmail: { contains: "test+" } }, { userId: { in: userIds } }, { shipping_email: { contains: "test+" } }, { shipping_name: { contains: "Tester" } }, ], }, });
  console.log(`Found ${orders.length} test orders:`);
  orders.forEach((o) => console.log(`- ${o.id} userId=${o.userId} customerEmail=${o.customerEmail} shipping_email=${o.shipping_email}`));

  const addresses = await prisma.userAddress.findMany({ where: { OR: [ { userId: { in: userIds } }, { fullName: { contains: "Dbg" } }, { label: { contains: "Casa" } }, ], }, });
  console.log(`Found ${addresses.length} test addresses:`);
  addresses.forEach((a) => console.log(`- ${a.id} userId=${a.userId} label=${a.label} fullName=${a.fullName}`));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
