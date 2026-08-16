#!/usr/bin/env python3
"""serve_nocache.py — 本地静态服务器（响应带 no-store，杜绝浏览器缓存）。

用法：python3 serve_nocache.py --port 8090 --dir <web-root>
"""
import argparse
import http.server
import socketserver


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 关键：所有响应强制不缓存，浏览器每次刷新都拿最新文件
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--dir", default=".")
    args = parser.parse_args()

    class ReuseTCPServer(socketserver.ThreadingTCPServer):
        allow_reuse_address = True   # 本地开发服务重启频繁，允许立即复用端口（TIME_WAIT）

    handler = lambda *a, **kw: NoCacheHandler(*a, directory=args.dir, **kw)
    with ReuseTCPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"no-cache 静态服务: http://127.0.0.1:{args.port} → {args.dir}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
