"""Start the app:  python run.py   then open http://127.0.0.1:8000"""
import argparse
import threading
import webbrowser

import uvicorn

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the Second Nature locally")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    parser.add_argument("--reload", action="store_true", help="restart automatically when code changes")
    args = parser.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    print(f"\n  Second Nature running at {url}  (press Ctrl+C to stop)\n")
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, reload=args.reload)
