"""Prepare speech benchmark clips without storing audio in Git."""
import argparse
import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--tts-url', required=True)
parser.add_argument('--directory', required=True)
args = parser.parse_args()
root = Path(args.directory)
root.mkdir(parents=True, exist_ok=True)
clips = root / 'clips'
clips.mkdir(exist_ok=True)
cases = []
phrases = [
    ('nappy', 'Add a nappy change at ten fifteen. Pee and poo.'),
    ('sleep', 'We had a sleep from nine in the morning to twelve noon today.'),
    ('syringe', 'Add a syringe feed of thirty milliliters of Aptamil at six twenty.'),
    ('temperature', 'Record a temperature of thirty seven point two degrees at eleven thirty.'),
    ('bath', 'We had a bath at six.'),
]
for name, text in phrases:
    original = clips / (name + '-original.wav')
    if not original.exists():
        request = urllib.request.Request(args.tts_url,
            json.dumps({'model': 'chatterbox', 'input': text, 'voice': 'Emily.wav', 'response_format': 'wav'}).encode(),
            {'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=300) as response:
            original.write_bytes(response.read())
    path = clips / (name + '.wav')
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(original), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(path)], check=True)
    cases.append({'id': name, 'kind': 'synthetic', 'path': str(path), 'reference': text})
for speaker in ['1089', '121']:
    folder = root / 'LibriSpeech' / 'test-clean' / speaker
    transcript = sorted(folder.glob('*/*.trans.txt'))[0]
    line = transcript.read_text().splitlines()[0]
    key, reference = line.split(' ', 1)
    path = clips / (key + '.wav')
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(transcript.parent / (key + '.flac')), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(path)], check=True)
    cases.append({'id': key, 'kind': 'public-natural', 'path': str(path), 'reference': reference})
if (root / 'household.wav').exists():
    cases.append({'id': 'household', 'kind': 'household', 'path': str(root / 'household.wav'), 'expectedPrefix': 'we had'})
    normalized = clips / 'household-normalized.wav'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(root / 'household.wav'), '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(normalized)], check=True)
    cases.append({'id': 'household-normalized', 'kind': 'household-processed', 'path': str(normalized), 'expectedPrefix': 'we had'})
path = clips / 'silence.wav'
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '5', '-c:a', 'pcm_s16le', str(path)], check=True)
cases.append({'id': 'silence', 'kind': 'silence', 'path': str(path), 'reference': ''})
path = clips / 'nappy-padded.wav'
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(clips / 'nappy.wav'), '-af', 'adelay=1000:all=1,apad=pad_dur=25', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(path)], check=True)
cases.append({'id': 'nappy-padded', 'kind': 'synthetic-padded', 'path': str(path), 'reference': phrases[0][1]})
for case in cases:
    case['sha256'] = hashlib.sha256(Path(case['path']).read_bytes()).hexdigest()
(root / 'corpus.json').write_text(json.dumps(cases, indent=2))
print('Prepared', len(cases), 'cases.', flush=True)
