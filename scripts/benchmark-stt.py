"""Compare CPU Parakeet v2 with an explicit whisper.cpp endpoint."""
import argparse
import fcntl
import json
import re
import resource
import statistics
import time
import urllib.request
import uuid
import wave
from pathlib import Path

def read_audio(path):
    import numpy as np

    with wave.open(str(path), 'rb') as audio:
        assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
        rate = audio.getframerate()
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return rate, samples


def whisper(path, url):
    boundary = uuid.uuid4().hex
    fields = {'model': 'large-v3-turbo', 'response_format': 'verbose_json', 'language': 'en',
              'detect_language': 'false', 'translate': 'false', 'temperature': '0', 'temperature_inc': '0',
              'no_timestamps': 'false', 'token_timestamps': 'false', 'no_language_probabilities': 'true',
              'offset_t': '0', 'duration': '0',
              'prompt': 'Breastfeeding, nappy, sleep, bath, pee, poo, vitamin D, umbilical cord.'}
    body = b''
    for key, value in fields.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
    body += Path(path).read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(url, body, {'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=240) as response:
        return json.load(response)['text'].strip()


def normalize(text):
    # Treat equivalent spoken and written numbers as the same words.
    small = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
    tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
    def number(match):
        value = int(match.group())
        if value < 20:
            return small[value]
        if value < 100:
            return tens[value // 10] + (' ' + small[value % 10] if value % 10 else '')
        return match.group()
    text = re.sub(r'(?<=\d)(?=ml\b)', ' ', text.lower())
    text = re.sub(r'\bat (\d{1,2})([0-5]\d)\b', r'at \1 \2', text)
    text = re.sub(r'\bto day\b', 'today', text)
    text = re.sub(r'\blove making\b', 'lovemaking', text)
    text = re.sub(r'\b(\d{1,2}):00\b', r'\1', text.lower())
    text = re.sub(r'\b(\d{1,2})[.:](\d{2})\b', r'\1 \2', text)
    text = re.sub(r'\b(\d+)\.(\d)\b', r'\1 point \2', text)
    text = re.sub(r'\b\d+\b', number, text)
    text = re.sub(r'\bml\b', 'milliliters', text)
    text = re.sub(r'\bmillilitres\b', 'milliliters', text)
    return re.findall(r'[a-z0-9]+', text)


def errors(reference, actual):
    a, b = normalize(reference), normalize(actual)
    previous = list(range(len(b) + 1))
    for i, word in enumerate(a, 1):
        row = [i]
        for j, other in enumerate(b, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (word != other)))
        previous = row
    return previous[-1], len(a)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest')
    parser.add_argument('model')
    parser.add_argument('output')
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--precision', choices=['int8','fp32'], default='int8')
    parser.add_argument('--parakeet-only', '--tune', dest='parakeet_only', action='store_true')
    parser.add_argument('--whisper-url')
    args = parser.parse_args()
    if not args.parakeet_only and not args.whisper_url:
        parser.error('Supply --whisper-url for a Whisper comparison.')
    import sherpa_onnx

    lock = open(Path(args.manifest).resolve().parent / 'benchmark.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    corpus = json.loads(Path(args.manifest).read_text())
    model = Path(args.model)
    results = {'runtime': sherpa_onnx.__version__, 'precision': args.precision.upper() + ' ONNX', 'provider': 'cpu',
               'threads': args.threads, 'repeats': args.repeats, 'results': []}
    started = time.perf_counter()
    suffix = '.int8.onnx' if args.precision == 'int8' else '.onnx'
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(model / ('encoder' + suffix)), decoder=str(model / ('decoder' + suffix)),
        joiner=str(model / ('joiner' + suffix)), tokens=str(model / 'tokens.txt'),
        model_type='nemo_transducer', provider='cpu', num_threads=args.threads)
    results['loadSeconds'] = time.perf_counter() - started
    for case in corpus:
        rate, samples = read_audio(case['path'])
        for engine in (['parakeet'] if args.parakeet_only else ['parakeet', 'whisper']):
            for attempt in range(args.repeats + 1):
                start = time.perf_counter()
                if engine == 'parakeet':
                    stream = recognizer.create_stream()
                    stream.accept_waveform(rate, samples)
                    recognizer.decode_stream(stream)
                    text = stream.result.text
                else:
                    text = whisper(case['path'], args.whisper_url)
                elapsed = time.perf_counter() - start
                row = {'case': case['id'], 'kind': case['kind'], 'engine': engine, 'attempt': attempt,
                       'warmup': attempt == 0, 'seconds': elapsed, 'audioSeconds': len(samples) / rate,
                       'text': text, 'reference': case.get('reference'), 'expectedPrefix': case.get('expectedPrefix')}
                if case.get('reference') is not None:
                    row['errors'], row['words'] = errors(case['reference'], text)
                if case.get('expectedPrefix'):
                    row['prefixCorrect'] = normalize(text)[:len(normalize(case['expectedPrefix']))] == normalize(case['expectedPrefix'])
                results['results'].append(row)
                results['parakeetProcessMaxRssMiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
                Path(args.output).write_text(json.dumps(results, indent=2))
                print(json.dumps({'case': case['id'], 'engine': engine, 'attempt': attempt, 'seconds': round(elapsed, 3), 'text': text}), flush=True)
    for engine in ['parakeet', 'whisper']:
        times = [r['seconds'] for r in results['results'] if r['engine'] == engine and not r['warmup']]
        if times:
            print(engine, 'median', statistics.median(times), flush=True)


if __name__ == '__main__':
    main()
