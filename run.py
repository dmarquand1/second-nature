"""Start the app:  python run.py   then open http://127.0.0.1:8000"""
import argparse
import socket
import sys
import threading
import webbrowser

import uvicorn

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Second Nature locally")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    parser.add_argument("--reload", action="store_true", help="restart automatically when code changes")
    args = parser.parse_args()

    # Is another copy already running on this port? Say so plainly instead of a long error.
    with socket.socket() as s:
        busy = s.connect_ex(("127.0.0.1", args.port)) == 0
    if busy:
        print(f"\n  Something is already running at http://127.0.0.1:{args.port} - probably Second Nature,"
              f"\n  started earlier in another terminal (find it and press Ctrl+C there)."
              f"\n  Or start a second copy on another port:  python run.py --port {args.port + 1}\n")
        sys.exit(1)

    url = f"http://127.0.0.1:{args.port}"
    print(f"\n  Second Nature running at {url}  (press Ctrl+C to stop)\n")
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, reload=args.reload)
