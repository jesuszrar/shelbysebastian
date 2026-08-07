async function run() {
  const email = `test+dbg${Date.now()}@example.com`;
  const password = 'testpass';
  const reg = await fetch('http://localhost:3001/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, data: { name: 'Dbg', cedula: String(Date.now()).slice(0,10) } }),
  });
  console.log('reg status', reg.status);
  const jr = await reg.json();
  console.log('reg body', jr);
  const token = jr.session?.access_token;
  const addrBody = { label: 'Casa', fullName: 'Dbg', department: 'D', city: 'C', address: 'Addr', isDefault: true };
  const addrRes = await fetch('http://localhost:3001/api/user/addresses', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(addrBody) });
  console.log('addr status', addrRes.status);
  console.log('addr body', await addrRes.text());
}

run().catch((e)=>{console.error(e); process.exit(1)});
