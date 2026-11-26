"""Downloads the real recordings the flight deck plays (src/cocksnd.js) and cuts them into sounds/real/:

    python tools/build_real_sounds.py [download folder]     (needs ffmpeg and numpy)

- gpws/<key>.mp3: real ground proximity warning words (the same Honeywell voice on the Airbuses, Boeings, ATR and Dash 8)
- bed/<set>-<idle|power|cruise>.wav: the inside of each aircraft at idle, at take-off power and cruising, 10 s loops
  (16 kHz mono WAV: an MP3's lead-in silence would stutter in a loop)
- fx/*.wav|mp3: an A350's flaps and gear, a small aircraft's flaps and gear, touchdown, the A320's cabin chime, the
  APU, metal creaking, tearing and scraping, fire

Every source is CC0 or CC BY (Freesound, Wikimedia Commons); sounds/real/CREDITS.md names each, and the stretches were
picked where nobody talks (checked with a speech recogniser). The crash itself is not here (ElevenLabs, to come).
"""
import io
import os
import subprocess
import sys
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'sounds', 'real')
SR = 16000

# id: (url, title, author, licence, page)
FS = 'https://cdn.freesound.org/previews/'
SOURCES = {
    'twinotter': (FS + '412/412197_8044044-hq.mp3', 'Airplane warning (DHC-6 Twin Otter GPWS, from the intercom)', 'OutofPhaze', 'CC0', 'https://freesound.org/s/412197/'),
    'bankangle': (FS + '583/583625_13165303-hq.mp3', 'bank_angle.mp3', 'IAMO_K', 'CC BY 3.0', 'https://freesound.org/s/583625/'),
    'c-terrain': ('https://upload.wikimedia.org/wikipedia/commons/3/38/%E9%A3%9B%E8%A1%8C%E6%A9%9F%E3%81%AEPull_up%E3%81%AE%E9%9F%B3%E5%A3%B0.wav', '飛行機のPull upの音声.wav', 'Okomedayo-13', 'CC0', 'https://commons.wikimedia.org/wiki/File:%E9%A3%9B%E8%A1%8C%E6%A9%9F%E3%81%AEPull_up%E3%81%AE%E9%9F%B3%E5%A3%B0.wav'),
    'c-sinkrate': ('https://upload.wikimedia.org/wikipedia/commons/5/5e/Sink_rate.wav', 'Sink rate.wav', 'unknown author (Wikimedia Commons)', 'CC BY 4.0', 'https://commons.wikimedia.org/wiki/File:Sink_rate.wav'),
    'c-lowgear': ('https://upload.wikimedia.org/wikipedia/commons/5/56/Too_low_gear.wav', 'Too low gear.wav', 'unknown author (Wikimedia Commons)', 'CC BY 4.0', 'https://commons.wikimedia.org/wiki/File:Too_low_gear.wav'),
    'c-lowflaps': ('https://upload.wikimedia.org/wikipedia/commons/a/a8/Too_low_flaps.wav', 'Too low flaps.wav', 'unknown author (Wikimedia Commons)', 'CC BY 4.0', 'https://commons.wikimedia.org/wiki/File:Too_low_flaps.wav'),
    'a320-takeoff': (FS + '677/677369_8779949-hq.mp3', 'Airbus A320 Takeoff.wav', 'Bryce835', 'CC0', 'https://freesound.org/s/677369/'),
    'a320-cabin': (FS + '459/459372_6072659-hq.mp3', 'PlanecabininteriorAirbus320.wav', 'devy32', 'CC0', 'https://freesound.org/s/459372/'),
    'a330-cabin': (FS + '456/456092_3025911-hq.mp3', 'Airplane cabin ambience / atmosphere Airbus A330-300', 'FillSoko', 'CC0', 'https://freesound.org/s/456092/'),
    'a350-gear': (FS + '787/787789_1315742-hq.mp3', 'Landing approach Airbus A350-900 extend landing gear', 'Marschal', 'CC0', 'https://freesound.org/s/787789/'),
    'a350-flaps': (FS + '787/787790_1315742-hq.mp3', 'In the cabin of an Airbus A350-900 landing flaps are adjusted during the approach', 'Marschal', 'CC0', 'https://freesound.org/s/787790/'),
    'b737-takeoff': (FS + '608/608803_8779949-hq.mp3', 'Boeing 737-700 takeoff.wav', 'Bryce835', 'CC0', 'https://freesound.org/s/608803/'),
    'b737-landing': (FS + '796/796060_1544275-hq.mp3', 'Air North 737 touchdown - interior', 'SoundsLikeYukon', 'CC0', 'https://freesound.org/s/796060/'),
    'b747-takeoff': (FS + '383/383279_7146007-hq.mp3', '747 Plane Taking off (Inside Cabin)', 'deleted_user_7146007', 'CC0', 'https://freesound.org/s/383279/'),
    'b777-cabin': (FS + '152/152579_2593738-hq.mp3', 'Boeing 777 interior jet engines inside', 'Pashee', 'CC BY 4.0', 'https://freesound.org/s/152579/'),
    'dash8': (FS + '450/450148_612689-hq.mp3', 'airplane prop Dash-8 int cockpit idle, take off, cruise, land', 'kyles', 'CC0', 'https://freesound.org/s/450148/'),
    'p47': (FS + '142/142900_2579915-hq.mp3', 'P-47 Thunderbolt Startup (radial engine)', 'Fight2FlyPhoto', 'CC BY 3.0', 'https://freesound.org/s/142900/'),
    'b17': (FS + '142/142897_2579915-hq.mp3', 'Spitfire and B-17 Taxi by', 'Fight2FlyPhoto', 'CC BY 3.0', 'https://freesound.org/s/142897/'),
    'flaps-small': (FS + '425/425274_8545280-hq.mp3', 'Airplane flaps', '77Pacer', 'CC0', 'https://freesound.org/s/425274/'),
    'gear-small': (FS + '425/425273_8545280-hq.mp3', 'Landing Gear', '77Pacer', 'CC0', 'https://freesound.org/s/425273/'),
    'chime': (FS + '457/457922_7197902-hq.mp3', 'A320 Double Chime.wav', 'JOHNNYFIVE', 'CC0', 'https://freesound.org/s/457922/'),
    'apu': (FS + '571/571919_5838112-hq.mp3', 'Airplane APU', 'alex36917', 'CC0', 'https://freesound.org/s/571919/'),
    'creak': (FS + '238/238289_1554038-hq.mp3', 'Long Metal Creak', 'LoafDV', 'CC0', 'https://freesound.org/s/238289/'),
    'creak-slow': (FS + '172/172411_2915633-hq.mp3', 'Creaking Metal - Slow', 'EagleStealthTeam', 'CC0', 'https://freesound.org/s/172411/'),
    'girders': (FS + '675/675486_2524442-hq.mp3', 'S35-22 Steel girders wrench and tear; creaking metal', 'craigsmith', 'CC0', 'https://freesound.org/s/675486/'),
    'alu-tear': (FS + '463/463857_9673575-hq.mp3', 'aluminum tearing on metal take one', '17nflores2', 'CC0', 'https://freesound.org/s/463857/'),
    'scrape': (FS + '534/534852_10898147-hq.mp3', 'MetalScrape_5.wav', 'deerlord', 'CC0', 'https://freesound.org/s/534852/'),
    'fire': (FS + '483/483323_2524442-hq.mp3', 'R30-09-Fires Burns Wood and Metal Crackling', 'craigsmith', 'CC0', 'https://freesound.org/s/483323/'),
}

# the GPWS words: out key, source, start, end (s)
GPWS = [
    ('pullup', 'bankangle', 9.9, 11.15),
    ('bankAngle', 'bankangle', 0.0, 1.62),
    ('terrain', 'c-terrain', 0.0, 1.48),
    ('sinkrate', 'c-sinkrate', 0.0, 0.68),
    ('lowGear', 'c-lowgear', 0.0, 1.18),
    ('lowFlaps', 'c-lowflaps', 0.0, 1.31),
    ('lowTerrain', 'twinotter', 5.85, 7.25),
    ('stall', 'twinotter', 0.55, 1.45),
]
# the insides: set, part, source, start, length 10 s
BEDS = [
    ('a320', 'idle', 'a320-takeoff', 5.5), ('a320', 'power', 'a320-takeoff', 27), ('a320', 'cruise', 'a320-cabin', 5),
    ('a330', 'cruise', 'a330-cabin', 45),
    ('a350', 'cruise', 'a350-gear', 10),
    ('b737', 'idle', 'b737-takeoff', 3), ('b737', 'power', 'b737-takeoff', 43), ('b737', 'cruise', 'b737-takeoff', 245),
    ('b747', 'power', 'b747-takeoff', 14), ('b747', 'cruise', 'b747-takeoff', 120),
    ('b777', 'cruise', 'b777-cabin', 4),
    ('dash8', 'idle', 'dash8', 15), ('dash8', 'power', 'dash8', 210), ('dash8', 'cruise', 'dash8', 440),
    ('radial', 'idle', 'p47', 40), ('radial', 'power', 'b17', 22),
]
# the rest: out file, source, start, end, loop?
FX = [
    ('a350-flaps.wav', 'a350-flaps', 0.4, 6.6, True),
    ('a350-gear.mp3', 'a350-gear', 46.5, 58, False),
    ('flaps-small.wav', 'flaps-small', 0.1, 4.0, True),
    ('gear-small.mp3', 'gear-small', 0, 4.0, False),
    ('touchdown.mp3', 'b737-landing', 24.3, 31, False),
    ('chime.mp3', 'chime', 0, 3.9, False),
    ('apu.wav', 'apu', 12, 22, True),
    ('creak-1.mp3', 'creak', 0, 3.13, False),
    ('creak-2.mp3', 'creak-slow', 2, 8, False),
    ('creak-3.mp3', 'creak-slow', 28, 34, False),
    ('tear-1.mp3', 'girders', 29, 37, False),
    ('tear-2.mp3', 'girders', 40, 47, False),
    ('tear-3.mp3', 'alu-tear', 0, 3.8, False),
    ('scrape.wav', 'scrape', 0.2, 8.2, True),
    ('fire.wav', 'fire', 50, 60, True),
]


def pcm(path, a, b):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(a), '-t', str(b - a), '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)


def level(x, to_db, peak=0.95):
    x = x * 10 ** ((to_db - rms_db(x)) / 20)
    p = np.abs(x).max()
    return x * (peak / p) if p > peak else x


def loop(x, fade=0.5):
    # the end crossfaded into the start (equal power): the loop comes round without a seam
    n = int(fade * SR)
    t = np.linspace(0, np.pi / 2, n)
    head, body, tail = x[:n], x[n:-n], x[-n:]
    return np.concatenate([body, tail * np.cos(t) + head * np.sin(t)])


def fades(x, a=0.02, b=0.25):
    na, nb = int(a * SR), int(b * SR)
    x = x.copy(); x[:na] *= np.linspace(0, 1, na); x[-nb:] *= np.linspace(1, 0, nb)
    return x


def write(path, x, mp3=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm16 = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    args = ['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-']
    args += ['-b:a', '64k', path] if mp3 else ['-c:a', 'pcm_s16le', path]
    subprocess.run(args, input=pcm16, check=True)


def speaker(path_in, path_out):
    # the GPWS words as loud as each other and as the made-up ones (tools/build_voices.py)
    # (no compressor: they come from a loudspeaker already, and squeezing raised their hiss)
    chain = ','.join(['highpass=f=200:poles=2', 'lowpass=f=5000:poles=2', 'loudnorm=I=-15:TP=-1.5:LRA=7', 'apad=pad_dur=0.04'])
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path_in, '-af', chain, '-ac', '1', '-ar', '22050', '-b:a', '56k', path_out], check=True)


def main():
    dl = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache-real')
    os.makedirs(dl, exist_ok=True)
    files = {}
    for k, (url, *_r) in SOURCES.items():
        f = os.path.join(dl, k + os.path.splitext(url.split('?')[0])[1])
        if not os.path.exists(f):
            req = urllib.request.Request(url, headers={'User-Agent': 'flightgame-sounds/1.0'})
            open(f, 'wb').write(urllib.request.urlopen(req).read())
        files[k] = f
    for key, src, a, b in GPWS:
        tmp = os.path.join(dl, f'gpws-{key}.wav')
        write(tmp, fades(pcm(files[src], a, b), 0.005, 0.03))
        os.makedirs(os.path.join(OUT, 'gpws'), exist_ok=True)
        speaker(tmp, os.path.join(OUT, 'gpws', key + '.mp3'))
    # the beds all as loud (-20 dB RMS): src/cocksnd.js sets how much of each
    for set_, part, src, a in BEDS:
        x = pcm(files[src], a, a + 10.5)
        write(os.path.join(OUT, 'bed', f'{set_}-{part}.wav'), level(loop(x), -20))
    for name, src, a, b, lp in FX:
        x = pcm(files[src], a, b)
        x = level(loop(x, 0.3), -20) if lp else level(fades(x), -18)
        write(os.path.join(OUT, 'fx', name), x, mp3=name.endswith('.mp3'))
    with io.open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8') as c:
        c.write('# Real recordings\n\nCut by `tools/build_real_sounds.py` from these recordings (thank you):\n\n')
        for k, (url, title, who, lic, page) in SOURCES.items():
            c.write(f'- [{title}]({page}) by {who}, {lic}\n')
    print('sounds/real written')


if __name__ == '__main__':
    main()
