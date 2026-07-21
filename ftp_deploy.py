#!/usr/bin/env python3
"""
FTP deploy script: recursively delete remote path contents and upload local folder.
Usage:
  python ftp_deploy.py --host HOST --port PORT --user USER --password PASS --remote REMOTE_DIR --local LOCAL_DIR

Be careful: this will DELETE files under the remote directory.
"""
import ftplib
import os
import argparse
import sys


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--host', required=True)
    p.add_argument('--port', type=int, default=21)
    p.add_argument('--user', required=True)
    p.add_argument('--password', required=True)
    p.add_argument('--remote', required=True)
    p.add_argument('--local', required=True)
    p.add_argument('--delete', action='store_true', help='Delete remote contents before upload')
    return p.parse_args()


class FTPDeployer:
    def __init__(self, host, port, user, password):
        self.ftp = ftplib.FTP()
        self.host = host
        self.port = port
        self.user = user
        self.password = password

    def connect(self):
        print(f"Connecting to {self.host}:{self.port}...")
        self.ftp.connect(self.host, self.port, timeout=30)
        self.ftp.login(self.user, self.password)
        self.ftp.set_pasv(True)
        print("Connected, welcome message:", self.ftp.getwelcome())

    def close(self):
        try:
            self.ftp.quit()
        except Exception:
            try:
                self.ftp.close()
            except Exception:
                pass

    # Helpers to safely change dir, create if not exist
    def ensure_cwd(self, path):
        try:
            self.ftp.cwd(path)
            return True
        except Exception:
            return False

    def makedir(self, path):
        try:
            self.ftp.mkd(path)
            print(f"Created dir: {path}")
        except ftplib.error_perm as e:
            # already exists or permission
            # print('mkd perm', e)
            pass
        except Exception as e:
            print('mkd error', e)

    def list_remote(self, path='.'):
        items = []
        try:
            items = self.ftp.nlst(path)
        except ftplib.error_perm as e:
            # empty dir or permission
            msg = str(e)
            if 'No such file or directory' in msg or '550' in msg:
                return []
            raise
        return items

    def is_dir(self, name):
        cwd = self.ftp.pwd()
        try:
            self.ftp.cwd(name)
            self.ftp.cwd(cwd)
            return True
        except Exception:
            return False

    def remove_file(self, path):
        try:
            self.ftp.delete(path)
            print(f"Deleted file: {path}")
        except Exception as e:
            print(f"Failed to delete file {path}: {e}")

    def remove_dir_recursive(self, path):
        # Try to list; if fails, skip
        try:
            self.ftp.cwd(path)
        except Exception:
            return
        entries = []
        try:
            entries = self.ftp.nlst()
        except Exception:
            entries = []
        for name in entries:
            if name in ('.', '..'):
                continue
            try:
                # test if directory
                if self.is_dir(name):
                    self.remove_dir_recursive(name)
                    try:
                        self.ftp.rmd(name)
                        print(f"Removed dir: {name}")
                    except Exception as e:
                        print(f"rmd failed {name}: {e}")
                else:
                    self.remove_file(name)
            except Exception as e:
                print(f"Error removing {name}: {e}")
        # go up handled by caller

    def ensure_remote_dirs(self, remote_path):
        parts = remote_path.strip('/').split('/') if remote_path.strip('/') else []
        cur = ''
        for p in parts:
            cur = f"{cur}/{p}" if cur else p
            try:
                self.ftp.cwd(cur)
            except Exception:
                try:
                    self.ftp.mkd(cur)
                except Exception as e:
                    print(f"Could not create remote dir {cur}: {e}")

    def upload_file(self, local_path, remote_path):
        dirname = os.path.dirname(remote_path)
        if dirname:
            # ensure remote dir exists
            self.ensure_remote_dirs(dirname)
        with open(local_path, 'rb') as f:
            try:
                self.ftp.storbinary(f'STOR {remote_path}', f)
                print(f"Uploaded: {remote_path}")
            except Exception as e:
                print(f"Failed upload {remote_path}: {e}")

    def upload_dir_recursive(self, local_root, remote_root):
        local_root = os.path.abspath(local_root)
        for dirpath, dirnames, filenames in os.walk(local_root):
            rel = os.path.relpath(dirpath, local_root)
            rel = '' if rel == '.' else rel.replace('\\', '/')
            remote_dir = (remote_root.rstrip('/') + ('/' + rel if rel else '')).lstrip('/')
            # ensure remote_dir exists
            self.ensure_remote_dirs(remote_dir)
            for fname in filenames:
                local_file = os.path.join(dirpath, fname)
                remote_file = (remote_dir + '/' + fname).lstrip('/')
                self.upload_file(local_file, remote_file)


if __name__ == '__main__':
    args = parse_args()
    if not os.path.isdir(args.local):
        print('Local directory does not exist:', args.local)
        sys.exit(1)

    deployer = FTPDeployer(args.host, args.port, args.user, args.password)
    try:
        deployer.connect()
        # change to remote base dir, create if necessary
        try:
            deployer.ftp.cwd(args.remote)
        except Exception:
            # try to create
            deployer.ensure_remote_dirs(args.remote)
            try:
                deployer.ftp.cwd(args.remote)
            except Exception as e:
                print('Could not access remote dir after creating:', e)
                deployer.close()
                sys.exit(1)

        if args.delete:
            print('Deleting contents of remote directory...')
            deployer.remove_dir_recursive('.')
        print('Starting upload...')
        deployer.upload_dir_recursive(args.local, '.')
        print('Upload finished')
    finally:
        deployer.close()
