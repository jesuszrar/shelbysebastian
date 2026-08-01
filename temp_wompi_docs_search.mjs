const fetch = globalThis.fetch || (await import('node-fetch')).default;
const url = 'https://developers.wompi.co/docs';
console.log('Fetching docs...');
const res = await fetch(url);
console.log('STATUS', res.status);
const text = await res.text();
const lower = text.toLowerCase();
const index = lower.indexOf('signature');
if (index === -1) {
  console.log('signature not found');
  process.exit(0);
}
const snippet = text.slice(Math.max(0, index - 200), index + 400);
console.log(snippet);
