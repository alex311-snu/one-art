"""ONE 로컬 개발 서버

GitHub에 올리기 전, 내 컴퓨터에서 공개 페이지와 관리자 페이지를 함께 테스트한다.
관리자 페이지에서 저장하면 data/, images/ 폴더의 파일이 바로 바뀐다.

    python dev_server.py          # http://localhost:8000
    python dev_server.py 8080     # 포트 지정

같은 와이파이의 휴대폰에서 보려면:  python dev_server.py --lan
(이 경우 관리자 저장 기능은 이 컴퓨터(localhost)에서만 허용된다)
"""
import base64
import datetime
import http.server
import json
import pathlib
import socket
import sys

ROOT = pathlib.Path(__file__).parent.resolve()
WRITABLE = ("data/", "images/")
MAX_BODY = 60 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def is_local_client(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/__local/ping"):
            if not self.is_local_client():
                return self.send_json(403, {"ok": False})
            return self.send_json(200, {"ok": True, "mode": "local"})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/__local/commit":
            return self.send_error(404)
        if not self.is_local_client():
            return self.send_error(403, "local only")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send_error(413)
        try:
            payload = json.loads(self.rfile.read(length))
            changed = []
            for f in payload.get("files", []):
                target = safe_path(f["path"])
                if f.get("delete"):
                    if target.exists():
                        target.unlink()
                    changed.append("삭제 " + f["path"])
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(base64.b64decode(f["base64"]))
                    changed.append("저장 " + f["path"])
        except (ValueError, KeyError) as e:
            return self.send_error(400, str(e))
        stamp = datetime.datetime.now().strftime("%H:%M:%S")
        print(f"[{stamp}] {payload.get('message', '')}")
        for c in changed:
            print("         " + c)
        return self.send_json(200, {"ok": True, "changed": changed})


def safe_path(rel):
    rel = str(rel).replace("\\", "/").lstrip("/")
    if not rel.startswith(WRITABLE):
        raise ValueError("data/ 또는 images/ 폴더에만 쓸 수 있습니다: " + rel)
    target = (ROOT / rel).resolve()
    if ROOT not in target.parents:
        raise ValueError("잘못된 경로: " + rel)
    return target


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    lan = "--lan" in sys.argv
    host = "0.0.0.0" if lan else "127.0.0.1"
    server = http.server.ThreadingHTTPServer((host, port), Handler)
    print("ONE 로컬 서버 실행 중")
    print(f"  컬렉션    http://localhost:{port}/")
    print(f"  작품 예시 http://localhost:{port}/a/?id=0027&src=nfc")
    print(f"  관리자    http://localhost:{port}/admin/")
    if lan and lan_ip():
        print(f"  휴대폰    http://{lan_ip()}:{port}/a/?id=0027&src=nfc  (같은 와이파이)")
    print("종료: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
