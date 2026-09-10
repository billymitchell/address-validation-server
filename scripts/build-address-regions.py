#!/usr/bin/env python3
"""Rebuild bundled region data from pinned public sources (Python and Ruby stdlib)."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import io
import subprocess
import tarfile
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CLDR = 'https://raw.githubusercontent.com/unicode-org/cldr/release-48-2/'
GOOGLE = 'https://raw.githubusercontent.com/google/libaddressinput/81eb9628382b07d371d8ea0b11badf7de3857fd5/'
SOURCES = {
    'subdivisions.xml': (CLDR + 'common/subdivisions/en.xml', '997a14da1144bb66f36a829db1783afe41f7529e33070afbe964bdd8e387b1d2'),
    'countries.xml': (CLDR + 'common/main/en.xml', '67607f4c9cf57157e70564987d8ae92a9ddcd73c00a2f1cd6abf79524a969cbd'),
    'aliases.xml': (CLDR + 'common/supplemental/supplementalMetadata.xml', '36e807ce72b15304dd993f132216f408351be1c4376edaa2fe9e9547e2efcac1'),
    'countryinfo.txt': (GOOGLE + 'testdata/countryinfo.txt', '51a5da9ac621f3457b96b99de798a47a02004f57e4289c1dd587a95730dad720'),
    'carmen.tar.gz': ('https://codeload.github.com/carmen-ruby/carmen/tar.gz/fc444d85437aeab864dd81d514e04a362212d1bf', '2c8af17f95a591be8fbeeee22fb8f04d70e66d67a756d4aa73494dc605db670f'),
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir', type=Path, help='Use already downloaded address-* source files, without networking')
args = parser.parse_args()
sources = {}
for filename, (url, digest) in SOURCES.items():
    data = (args.source_dir / ('address-' + filename)).read_bytes() if args.source_dir else urllib.request.urlopen(url, timeout=30).read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Source checksum mismatch: ' + filename)
    sources[filename] = data

# Each record is [preferred full name, alternative names/codes...], scoped by country.
regions = {}
for node in ET.fromstring(sources['subdivisions.xml']).findall('.//subdivision'):
    code = node.attrib['type'].upper()
    name = re.sub('[¹²³⁴⁵⁶⁷⁸⁹]+$', '', node.text or '').strip()
    if name and len(code) > 2:
        regions.setdefault(code[:2], {})[code[2:]] = [name]

replacements = {}
for node in ET.fromstring(sources['aliases.xml']).findall('.//subdivisionAlias'):
    old, new = node.attrib['type'].upper(), node.attrib['replacement'].upper()
    if ' ' not in new and new[:2] == old[:2] and new[2:] in regions.get(new[:2], {}):
        replacements[old] = new
        target = regions[new[:2]][new[2:]]
        target.extend([old[2:], old[:2] + '-' + old[2:]])
        target.extend(regions[old[:2]].get(old[2:], []))
        if old != new:
            regions[old[:2]].pop(old[2:], None)

# Google's postal keys include aliases such as NSW, QLD, D.F., and native names.
# Supplement CLDR names; never replace a current CLDR name with an old fixture name.
for line in sources['countryinfo.txt'].decode().splitlines():
    key, _, raw = line.partition('=')
    if not re.fullmatch(r'data/[A-Z]{2}', key):
        continue
    row = json.loads(raw)
    country = key[5:]
    keys = row.get('sub_keys', '').split('~')
    columns = [row.get(field, '').split('~') for field in ['sub_names', 'sub_lnames', 'sub_isoids']]
    for index, postal_key in enumerate(keys):
        if not postal_key:
            continue
        native, latin, iso = [column[index] if index < len(column) else '' for column in columns]
        code = (iso or postal_key).upper()
        # Non-code keys without an ISO id are still useful exact-name aliases.
        qualified = replacements.get(country + code, country + code)
        code = qualified[2:]
        entry = regions.setdefault(country, {}).setdefault(code, [latin or native or postal_key])
        entry.extend(value for value in [postal_key, native, latin, iso] if value)

# Preserve storefront spellings for US territories/military addresses.
for code, name in {
    'AA': 'Armed Forces Americas (except Canada)',
    'AE': 'Armed Forces Africa, Canada, Europe, Middle East',
    'AP': 'Armed Forces Pacific', 'VI': 'Virgin Islands',
    'UM': 'United States Minor Outlying Islands',
}.items():
    regions['US'][code] = [name] + regions['US'].get(code, [])

countries = {}
for node in ET.fromstring(sources['countries.xml']).findall('.//territories/territory'):
    code = node.attrib['type']
    if re.fullmatch('[A-Z]{2}', code) and code not in ['ZZ', 'EU', 'EZ', 'UN', 'QO']:
        countries.setdefault(code, []).append(node.text)

# The storefront country_states.js identifies Carmen as its source. Add Carmen's
# native and English names by ISO code, so e.g. Bavaria matches its value Bayern.
yaml_files = {}
with tarfile.open(fileobj=io.BytesIO(sources['carmen.tar.gz'])) as archive:
    for member in archive.getmembers():
        if member.isfile() and re.search(r'/locale/(base|overlay)/en/world(?:/[a-z0-9]+)*\.yml$', member.name):
            yaml_files[member.name] = archive.extractfile(member).read().decode()
        if member.name.endswith('/MIT-LICENSE'):
            (ROOT / 'licenses' / 'Carmen-MIT.txt').write_bytes(archive.extractfile(member).read())
parsed = json.loads(subprocess.run([
    'ruby', '-rjson', '-ryaml', '-e',
    'puts JSON.generate(JSON.parse(STDIN.read).transform_values { |text| YAML.safe_load(text) })'
], input=json.dumps(yaml_files), text=True, capture_output=True, check=True).stdout)

def collect_names(tree, path=()):
    if not isinstance(tree, dict):
        return
    if len(path) == 1:
        for field in ['name', 'common_name', 'official_name']:
            if tree.get(field):
                countries.setdefault(path[0].upper(), []).append(tree[field])
    elif len(path) >= 2 and tree.get('name'):
        country, code = path[0].upper(), path[-1].upper()
        qualified = replacements.get(country + code, country + code)
        record = regions.setdefault(country, {}).setdefault(qualified[2:], [tree['name']])
        record.append(tree['name'])
    for code, child in tree.items():
        if isinstance(child, dict):
            collect_names(child, path + (code,))

for tree in parsed.values():
    collect_names(tree.get('en', {}).get('world', {}))

for code, name in {'MK': 'Macedonia, Republic of', 'SZ': 'Swaziland', 'CV': 'Cape Verde', 'CZ': 'Czech Republic'}.items():
    countries.setdefault(code, []).append(name)

for subdivisions in regions.values():
    for code, names in subdivisions.items():
        subdivisions[code] = list(dict.fromkeys(names))

def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

block = '\n'.join([
    '  // BEGIN GENERATED GLOBAL REGIONS',
    '  // Generated by scripts/build-address-regions.py. Do not edit this block.',
    '  // Unicode CLDR 48.2 (Unicode-3.0); Google libaddressinput (CC BY 4.0); Carmen (MIT).',
    '  // Attribution and sources: licenses/address-data.md; licenses/Unicode-3.0.txt.',
    '  var countryNames = ' + encode(countries) + ';',
    '  var subdivisionData = {',
    ',\n'.join('    ' + encode(country) + ':' + encode(subdivisions) for country, subdivisions in sorted(regions.items())),
    '  };',
    '  // END GENERATED GLOBAL REGIONS',
])
path = ROOT / 'address-validation.js'
script = path.read_text()
pattern = r'  // BEGIN GENERATED GLOBAL REGIONS.*?  // END GENERATED GLOBAL REGIONS'
if not re.search(pattern, script, re.S):
    raise ValueError('Missing generated data markers')
script = re.sub(pattern, lambda _: block, script, flags=re.S)
path.write_text(script)
print(f'Bundled {sum(map(len, regions.values()))} subdivision entries across {len(regions)} countries/territories.')
