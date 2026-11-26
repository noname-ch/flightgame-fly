"""Headless autopilot test: flies a whole A320 flight in Chrome (no 3D, flat ground) and prints the log.

    python test/run.py [FROM TO [TYPE]]     e.g. python test/run.py LHR DUB B737-800

Builds test-ap.html (index.html without the 3D view and the boot script, with test/ap-test.js), serves the repo on
a free port and reads the result out of Chrome's DOM dump. Exits 1 when the flight fails.
"""
import http.server
import io
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import html as htmlmod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME_PATHS = [os.environ.get('CHROME', ''), r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe', 'google-chrome', 'chromium', 'chromium-browser']


def chrome():
    for c in CHROME_PATHS:
        if c and (os.path.exists(c) or shutil.which(c)):
            return c
    sys.exit('Chrome not found: set CHROME=/path/to/chrome')


def main():
    frm, to = (sys.argv[1], sys.argv[2]) if len(sys.argv) >= 3 else ('ZRH', 'GVA')
    typ = sys.argv[3] if len(sys.argv) >= 4 else 'A320'
    page = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    page = re.sub(r'\s*<script type="module"[^>]*></script>', '', page)
    page = re.sub(r'\s*<script src="\.\./src/boot\.js[^"]*"></script>', '', page)
    stub = ('<script>FG.view3d = { on: true, map: null, setOn() {}, pilotCam() {}, fov: () => 36.87 }; FG.flat = null;</script>\n'
            # (the aircraft's systems too, as the 3D deck loads them: fuel burns off, hydraulics, power, radios)
            + ('' if os.environ.get('NOSYS') else '  <script src="../src/systems.js"></script>\n  <script src="../src/aircraft.js"></script>\n  <script src="../src/radio.js"></script>\n') +
            '  <script src="../test/ap-test.js"></script>\n</body>')
    page = page.replace('</body>', stub)
    test_page = os.path.join(ROOT, 'test-ap.html')
    io.open(test_page, 'w', encoding='utf-8').write(page)

    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=ROOT, **k)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = os.path.join(ROOT, '.test-profile')
    try:
        r = subprocess.run([chrome(), '--headless=new', '--disable-gpu', '--no-first-run', f'--user-data-dir={profile}',
                            '--virtual-time-budget=60000', '--run-all-compositor-stages-before-draw',
                            '--dump-dom', f'http://127.0.0.1:{port}/test-ap.html?from={frm}&to={to}&type={typ}' + ('&flare=' + os.environ['FLARE'] if os.environ.get('FLARE') else '') + ('&tune=' + os.environ['TUNE'] if os.environ.get('TUNE') else '')],
                           capture_output=True, text=True, timeout=300, encoding='utf-8', errors='replace')
    finally:
        srv.shutdown()
        os.remove(test_page)
        shutil.rmtree(profile, ignore_errors=True)
    m = re.search(r'<pre id="out">(.*?)</pre>', r.stdout, re.S)
    if not m:
        print('no result from the page'); print(r.stderr[-3000:]); sys.exit(1)
    text = htmlmod.unescape(m.group(1))
    print(text)
    sys.exit(0 if text.rstrip().endswith('PASS') else 1)


if __name__ == '__main__':
    main()
