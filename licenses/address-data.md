# Address data attribution

The generated data embedded in `address-validation.js` is adapted from:

- Unicode CLDR 48.2, copyright © 1991–2025 Unicode, Inc. Licensed under
  [Unicode License v3](Unicode-3.0.txt). Source:
  https://github.com/unicode-org/cldr/tree/release-48-2/common
- Google libaddressinput address metadata, revision
  `81eb9628382b07d371d8ea0b11badf7de3857fd5`, licensed under
  [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
  Source: https://github.com/google/libaddressinput/blob/81eb9628382b07d371d8ea0b11badf7de3857fd5/testdata/countryinfo.txt
  License statement: https://github.com/google/libaddressinput#license
- Carmen country and subdivision names, revision
  `fc444d85437aeab864dd81d514e04a362212d1bf`, under the [MIT License](Carmen-MIT.txt).
  Source: https://github.com/carmen-ruby/carmen/tree/fc444d85437aeab864dd81d514e04a362212d1bf/locale

Changes: extracted country/subdivision names, joined postal and legacy-code
aliases, removed CLDR superscript disambiguators, retained storefront spellings
for US military and territory options, and bundled the result as JavaScript.
The Google test fixture supplies additional aliases; CLDR supplies the preferred
names where available. These datasets describe region names, not API coverage or
proof of deliverability.

Regenerate using `python3 scripts/build-address-regions.py` (Python 3 and Ruby with
their standard libraries). The generator checks
SHA-256 hashes of the pinned source files and does not run downloaded code.
