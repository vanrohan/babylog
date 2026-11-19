"""Test transcript scoring without changing recognizer output."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('benchmark', Path(__file__).with_name('benchmark-stt.py'))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class Scoring(unittest.TestCase):
    def test_time_and_amount_formats(self):
        for actual, reference in [('at 10:15', 'at ten fifteen'), ('at 1130', 'at eleven thirty'),
                                  ('30ml', 'thirty milliliters'), ('37.2', 'thirty seven point two'),
                                  ('at 09:00', 'at nine')]:
            self.assertEqual(benchmark.errors(reference, actual)[0], 0)

    def test_meaning_changes_remain_errors(self):
        self.assertGreater(benchmark.errors('we had', 'I had')[0], 0)
        self.assertGreater(benchmark.errors('pee and poo', 'key and poo')[0], 0)
        self.assertGreater(benchmark.errors('at nine', 'at eight')[0], 0)
        self.assertEqual(benchmark.errors('we had a bath', 'a bath'), (2, 4))
        self.assertEqual(benchmark.errors('pee and poo', 'pee and'), (1, 3))

    def test_silence_and_compound_words(self):
        self.assertEqual(benchmark.errors('', ''), (0, 0))
        self.assertEqual(benchmark.errors('', 'Thank you.'), (2, 0))
        self.assertEqual(benchmark.errors('today lovemaking', 'to day love making')[0], 0)


if __name__ == '__main__':
    unittest.main()
