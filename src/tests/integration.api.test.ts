import { spawn } from "child_process";

const BACKEND_CMD = "npm";
const BACKEND_ARGS = ["--prefix", "backend", "run", "dev"];

const waitForServer = async (timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch("http://localhost:3001/health");
      if (r.ok) return true;
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Server did not start in time");
};

describe("Backend integration: addresses & orders", () => {
  let proc: any;
  beforeAll(async () => {
    proc = spawn(BACKEND_CMD, BACKEND_ARGS, { shell: true, stdio: "ignore" });
    await waitForServer(20000);
  }, 30000);

  afterAll(() => {
    if (proc) proc.kill();
  });

  it("registers user, creates address (auth) and creates order with shipping_* persisted", async () => {
    const unique = Date.now();
    const email = `test+${unique}@example.com`;
    const password = "test-password";
    const registerRes = await fetch("http://localhost:3001/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, data: { name: "Tester", cedula: String(unique) } }),
    });
    expect(registerRes.status).toBe(200);
    const jr = await registerRes.json();
    const token = jr.session?.access_token;
    const userId = jr.user?.id;
    expect(token).toBeTruthy();

    // create address
    const addrBody = { label: "Casa", fullName: "Tester", department: "D", city: "C", address: "Addr", isDefault: true };
    const addrRes = await fetch("http://localhost:3001/api/user/addresses", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(addrBody),
    });
    expect(addrRes.status).toBe(200);
    const addr = await addrRes.json();
    expect(addr.id).toBeTruthy();

    // create order linked to user
    const orderBody = { items: [], total: 5000, shipping: 0, customerName: "Tester", customerEmail: email, customerPhone: "3000000", customerCity: "C", customerAddress: "Addr", userId, shipping_name: "Tester", shipping_email: email, shipping_phone: "3000000", shipping_department: "D", shipping_city: "C", shipping_address: "Addr", shipping_reference: "Ref" };
    const orderRes = await fetch("http://localhost:3001/api/data/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody),
    });
    expect(orderRes.status).toBe(200);
    const orders = await orderRes.json();
    expect(Array.isArray(orders)).toBe(true);
    const created = orders[0];
    expect(created.shipping_name).toBe("Tester");
    expect(created.shipping_email).toBe(email);
  }, 30000);
});
