import("dotenv/config");
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const userIds = [
  "cmsgd5moh0000dh0s3q9xwb3z",
  "cmsgd6eq50001dh0snveuz4u8",
  "cmsggwng60000dh2cwsmd3xam",
  "cmsggy4xj0003dh2cjlz6q1y8",
  "cmsggz77v0006dh2ccmksdkao",
  "cmsgh08is0007dh2cor1o1vz7",
  "cmsgh10jc0000dhrctznqz77p",
  "cmsgh1klb0000dh1saku0obl7",
  "cmsgh27am0002dh1sxs1twxqg",
  "cmsgh321d0004dh1s1wux1jxd",
];

const orderIds = [
  "312a6dcf-3180-45ce-9fcb-c06aa3902157",
  "b8ea285b-e4ec-43cc-a970-6e56b57e4b46",
];

const addressIds = [
  "cmsgh1mmj0001dh1s5r6lrmdq",
  "cmsgh28e00003dh1sc20nquvb",
  "cmsgh335c0005dh1sa3lh85me",
];

async function main() {
  console.log("Deleting test orders...");
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  console.log("Deleting test addresses...");
  await prisma.userAddress.deleteMany({ where: { id: { in: addressIds } } });

  console.log("Deleting test users...");
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log("Cleanup complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
