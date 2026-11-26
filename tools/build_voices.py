"""Records the flight deck's voice callouts (GPWS, radio altitude, stall, take-off and landing calls) for each
family of aircraft, into sounds/voice/<family>/<key>.mp3. src/cocksnd.js plays them.

    python -m venv tts && tts/bin/pip install piper-tts
    for v in joe john bryce norman; do tts/bin/python -m piper.download_voices en_US-$v-medium; done
    tts/bin/python tools/build_voices.py <folder with the .onnx voices>

Each family has its own voice and speaker, as each maker's warning computer sounds a little different:
- airbus: "john", a little quicker; Airbus wording (twenty five hundred, retard, minimum, stall stall)
- boeing: "joe", firm and even; Boeing wording (two thousand five hundred, minimums, don't sink)
- regional: "bryce" (ATR, Dash 8, the Global 7500's Honeywell box)
- concorde: "norman" through a narrower, older speaker (a 1970s Mk II GPWS)
The DC-3 and the Ju 52 have no warning computer: no voice at all.

The voices are Piper's (github.com/rhasspy/piper) trained on public-domain / CC0 recordings (joe: CC0; john, bryce,
norman: LibriVox, public domain), so the recordings are free to ship. Needs ffmpeg.
"""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'sounds', 'voice')

# key -> words. The radio altitudes are a0010 … a2500.
COMMON = {
    'pullup': 'Pull up!',
    'terrain': 'Terrain, terrain.',
    'terrainAhead': 'Terrain ahead!',
    'terrainAheadPullup': 'Terrain ahead, pull up!',
    'cautionTerrain': 'Caution, terrain.',
    'sinkrate': 'Sink rate!',
    'lowGear': 'Too low, gear!',
    'lowFlaps': 'Too low, flaps!',
    'lowTerrain': 'Too low, terrain!',
    'glideslope': 'Glide slope.',
    'bankAngle': 'Bank angle, bank angle.',
    'v1': 'Vee one.',
    'rotate': 'Rotate.',
    'a1000': 'One thousand.',
    'a0500': 'Five hundred.',
    'a0100': 'One hundred.',
    'a0050': 'Fifty.',
    'a0040': 'Forty.',
    'a0030': 'Thirty.',
    'a0020': 'Twenty.',
    'a0010': 'Ten.',
    'hundredAbove': 'Hundred above.',
    'evacuate': 'Evacuate, evacuate.',
    'tailStrike': 'Tail strike.',
    'config': 'Config.',
    'topOfDescent': 'Top of descent.',
    'youHaveControl': 'You have control.',
    'windshear': 'Windshear, windshear, windshear.',
    'overspeed': 'Overspeed.',
    'dontSink': "Don't sink!",
}
FAMILIES = {
    'airbus': {
        'voice': 'en_US-john-medium', 'length': 0.86, 'hp': 300, 'lp': 4200, 'drive': 4,
        'words': {**COMMON, 'a2500': 'Twenty five hundred.', 'retard': 'Retard. Retard.', 'minimum': 'Minimum.',
                  'stall': 'Stall! Stall!', 'thrustLeversClimb': 'Thrust levers, climb.', 'speed': 'Speed, speed, speed.',
                  'dualInput': 'Dual input.', 'dontSink': "Don't sink!"},
    },
    'boeing': {
        'voice': 'en_US-joe-medium', 'length': 0.92, 'hp': 280, 'lp': 4000, 'drive': 5,
        'words': {**COMMON, 'a2500': 'Two thousand five hundred.', 'minimum': 'Minimums.', 'dontSink': "Don't sink!",
                  'approachingMinimums': 'Approaching minimums.', 'retard': 'Retard.', 'stall': 'Stall.'},
    },
    'regional': {
        'voice': 'en_US-bryce-medium', 'length': 0.9, 'hp': 320, 'lp': 3800, 'drive': 5,
        'words': {**COMMON, 'a2500': 'Two thousand five hundred.', 'minimum': 'Minimums.', 'dontSink': "Don't sink!",
                  'retard': 'Retard.', 'stall': 'Stall.'},
    },
    'concorde': {
        'voice': 'en_US-norman-medium', 'length': 0.95, 'hp': 450, 'lp': 2900, 'drive': 8,
        'words': {k: COMMON[k] for k in ('pullup', 'terrain', 'sinkrate', 'lowGear', 'lowFlaps', 'lowTerrain', 'glideslope',
                                         'v1', 'rotate', 'a1000', 'a0500', 'a0100', 'a0050', 'a0040', 'a0030', 'a0020',
                                         'a0010', 'hundredAbove', 'evacuate', 'tailStrike', 'config', 'youHaveControl',
                                         'overspeed', 'bankAngle', 'terrainAhead', 'terrainAheadPullup', 'cautionTerrain',
                                         'windshear', 'topOfDescent', 'dontSink')}
                 | {'a2500': 'Two thousand five hundred.', 'minimum': 'Decide.', 'retard': 'Retard.', 'stall': 'Stall.'},
    },
}


def record(models, fam, key, text, tmp):
    f = FAMILIES[fam]
    raw = os.path.join(tmp, f'{fam}-{key}.wav')
    piper = os.path.join(os.path.dirname(sys.executable), 'piper')
    subprocess.run([piper, '-m', os.path.join(models, f['voice'] + '.onnx'), '--length-scale', str(f['length']),
                    '--sentence-silence', '0', '-f', raw], input=text.encode(), check=True, capture_output=True)
    out = os.path.join(OUT, fam, key + '.mp3')
    # the flight deck's loudspeaker: band-limited, squeezed flat (the warnings are always as loud), a little driven
    chain = ','.join([
        'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_threshold=-45dB:stop_duration=0.15',
        f'highpass=f={f["hp"]}:poles=2', f'highpass=f={f["hp"]}:poles=2', f'lowpass=f={f["lp"]}:poles=2', f'lowpass=f={f["lp"]}:poles=2',
        'equalizer=f=1800:t=q:w=1.2:g=5',
        'acompressor=threshold=-24dB:ratio=6:attack=3:release=60:makeup=8',
        f'volume={f["drive"]}dB', 'asoftclip=type=tanh',
        'loudnorm=I=-15:TP=-1.5:LRA=5',
        'apad=pad_dur=0.04',
    ])
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', chain, '-ac', '1', '-ar', '22050', '-b:a', '56k', out],
                   check=True)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    models = sys.argv[1]
    with tempfile.TemporaryDirectory() as tmp:
        for fam, f in FAMILIES.items():
            os.makedirs(os.path.join(OUT, fam), exist_ok=True)
            for key, text in f['words'].items():
                record(models, fam, key, text, tmp)
            print(f'{fam}: {len(f["words"])} callouts')


if __name__ == '__main__':
    main()
