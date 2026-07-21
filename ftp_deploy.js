const ftp = require('basic-ftp');
const path = require('path');

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 6) {
        console.log('Usage: node ftp_deploy.js HOST PORT USER PASS REMOTE_DIR LOCAL_DIR');
        process.exit(1);
    }
    const [host, port, user, pass, remoteDir, localDir] = args;
    const client = new ftp.Client();
    client.ftp.verbose = true;
    try {
        console.log(`Connecting to ${host}:${port} as ${user}`);
        await client.access({ host, port: parseInt(port), user, password: pass, secure: false });
        console.log('Connected');
        // Normalize remoteDir
        const remote = remoteDir.replace(/\\/g, '/');
        try {
            console.log('Removing remote directory (if exists):', remote);
            await client.removeDir(remote);
            console.log('Remote directory removed');
        } catch (e) {
            console.log('Could not remove remote dir (might not exist):', e.message);
        }
        // Ensure remote dir
        await client.ensureDir(remote);
        await client.clearWorkingDir();
        console.log('Uploading local dir', localDir, 'to remote', remote);
        await client.uploadFromDir(localDir, remote);
        console.log('Upload complete');
    } catch (err) {
        console.error('FTP error:', err);
    } finally {
        client.close();
    }
}

main();
