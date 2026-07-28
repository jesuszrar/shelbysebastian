const Client = require('ssh2-sftp-client');
const s = new Client();

(async () => {
  try {
    console.log('📤 Uploading dist/index.html to public_html/index.html via SFTP...');
    await s.connect({ host: '149.62.37.234', port: 65002, username: 'u970251027', password: '3016030030Zr@' });
    await s.fastPut('./dist/index.html', 'public_html/index.html');
    console.log('✅ index.html updated on production');
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    await s.end().catch(() => {});
  }
})();
