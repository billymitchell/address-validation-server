/**
 * Intercepts checkout submission, validates the entered address, and lets the
 * shopper choose between Google's suggestion and the original address.
 *
 * Configure the endpoint on the form:
 * <form data-validation-api="https://your-app.herokuapp.com">
 *
 * The script intentionally never contains a Google API key. It calls the
 * server-side validation proxy instead.
 */
(function addressValidationCheckout() {
    'use strict';

    var DEFAULT_API_URL = 'https://address-validation-centricity-e22fd890f144.herokuapp.com';
    var form = document.querySelector('#checkout-form');

    if (!form) {
        return;
    }

    var apiUrl = (form.dataset.validationApi || DEFAULT_API_URL).replace(/\/+$/, '');
    var submitButton = form.querySelector('input[type="submit"], button[type="submit"]');
    var nativeSubmit = false;

    var fields = {
        addressLine1: form.querySelector('.first-address'),
        addressLine2: form.querySelector('.second-address'),
        city: form.querySelector('.city'),
        state: form.querySelector('.state'),
        postalCode: form.querySelector('.zip'),
        country: form.querySelector('.country'),
        company: form.querySelector('.company')
    };

    var COUNTRY_CODES = {
        'United States': 'US',
        'Canada': 'CA',
        'United Kingdom': 'GB',
        'Australia': 'AU',
        'New Zealand': 'NZ',
        'Mexico': 'MX',
        'Ireland': 'IE',
        'France': 'FR',
        'Germany': 'DE',
        'Italy': 'IT',
        'Spain': 'ES',
        'Netherlands': 'NL',
        'Belgium': 'BE',
        'Japan': 'JP',
        'China': 'CN',
        'India': 'IN',
        'Brazil': 'BR'
    };
    var US_STATE_NAMES = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
        CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
        HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
        KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
        MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
        MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
        NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
        ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
        RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
        TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
        WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
    };

    function valueOf(field) {
        return field ? field.value.trim() : '';
    }

    function countryCode() {
        if (!fields.country) {
            return '';
        }
        return fields.country.selectedOptions[0].dataset.regionCode
            || COUNTRY_CODES[fields.country.value]
            || '';
    }

    function readAddress() {
        var addressLines = [valueOf(fields.addressLine1), valueOf(fields.addressLine2)]
            .filter(Boolean);
        return {
            regionCode: countryCode(),
            addressLines: addressLines,
            locality: valueOf(fields.city),
            administrativeArea: valueOf(fields.state),
            postalCode: valueOf(fields.postalCode),
            organization: valueOf(fields.company)
        };
    }

    function displayAddress(address) {
        var lines = (address.addressLines || []).filter(Boolean);
        if (address.organization) {
            lines.unshift(address.organization);
        }
        if (address.locality || address.administrativeArea || address.postalCode) {
            lines.push([address.locality, address.administrativeArea, address.postalCode]
                .filter(Boolean).join(', '));
        }
        if (address.regionCode) {
            lines.push(address.regionCode);
        }
        return lines.length ? lines.join('\n') : (address.formattedAddress || 'No address provided');
    }

    function normalizeSuggestedAddress(address) {
        return {
            addressLines: address.addressLines || [],
            locality: address.locality || '',
            administrativeArea: address.administrativeArea || '',
            postalCode: address.postalCode || '',
            regionCode: address.regionCode || '',
            organization: address.organization || ''
        };
    }

    function addressesMatch(original, suggested) {
        return JSON.stringify(normalizeSuggestedAddress(original))
            === JSON.stringify(normalizeSuggestedAddress(suggested));
    }

    function setSelectValue(select, value, regionCode) {
        if (!select || !value && !regionCode) {
            return;
        }
        var options = Array.from(select.options);
        var normalizedValue = String(value || '').trim().toLowerCase();
        var stateName = US_STATE_NAMES[String(value || '').trim().toUpperCase()];
        var option = options.find(function (candidate) {
            return candidate.dataset.regionCode === regionCode;
        }) || options.find(function (candidate) {
            return candidate.value.trim().toLowerCase() === normalizedValue
                || candidate.text.trim().toLowerCase() === normalizedValue
                || candidate.value.trim().toLowerCase() === String(stateName || '').toLowerCase();
        });
        if (option) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function applyAddress(address) {
        var lines = address.addressLines || [];
        if (fields.addressLine1) fields.addressLine1.value = lines[0] || '';
        if (fields.addressLine2) fields.addressLine2.value = lines[1] || '';
        if (fields.city) fields.city.value = address.locality || '';
        if (fields.postalCode) fields.postalCode.value = address.postalCode || '';
        if (fields.state) setSelectValue(fields.state, address.administrativeArea);
        if (fields.country) {
            var countryName = Object.keys(COUNTRY_CODES).find(function (name) {
                return COUNTRY_CODES[name] === address.regionCode;
            });
            setSelectValue(fields.country, countryName || '', address.regionCode);
        }
    }

    function continueWith(address) {
        applyAddress(address);
        nativeSubmit = true;
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(submitButton);
        } else {
            HTMLFormElement.prototype.submit.call(form);
        }
    }

    function createModal(original, suggested) {
        var modal = document.createElement('div');
        modal.className = 'address-validation-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'address-validation-title');
        modal.innerHTML = [
            '<div class="address-validation-backdrop"></div>',
            '<div class="address-validation-dialog">',
            '<h2 id="address-validation-title">Confirm your address</h2>',
            '<p>We found a possible update. Which address would you like to use?</p>',
            '<div class="address-validation-comparison">',
            '<section><h3>Previously entered</h3><pre data-original-address></pre></section>',
            '<section><h3>Suggested address</h3><pre data-suggested-address></pre></section>',
            '</div>',
            '<div class="address-validation-actions">',
            '<button type="button" data-use-previous>Continue with previous address</button>',
            '<button type="button" data-use-updated class="primary">Use updated address</button>',
            '</div>',
            '</div>'
        ].join('');
        modal.querySelector('[data-original-address]').textContent = displayAddress(original);
        modal.querySelector('[data-suggested-address]').textContent = displayAddress(suggested);
        document.body.appendChild(modal);

        var closeAndContinue = function (address) {
            modal.remove();
            continueWith(address);
        };
        modal.querySelector('[data-use-previous]').addEventListener('click', function () {
            closeAndContinue(original);
        });
        modal.querySelector('[data-use-updated]').addEventListener('click', function () {
            closeAndContinue(suggested);
        });
        modal.querySelector('.address-validation-backdrop').addEventListener('click', function () {
            modal.querySelector('[data-use-previous]').focus();
        });
        modal.querySelector('[data-use-updated]').focus();
    }

    function showError(message) {
        var existing = form.querySelector('[data-address-validation-error]');
        if (!existing) {
            existing = document.createElement('p');
            existing.dataset.addressValidationError = '';
            existing.setAttribute('role', 'alert');
            form.prepend(existing);
        }
        existing.textContent = message;
    }

    function addModalStyles() {
        if (document.getElementById('address-validation-styles')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'address-validation-styles';
        style.textContent = [
            '.address-validation-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:1rem;font-family:inherit}',
            '.address-validation-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}',
            '.address-validation-dialog{position:relative;width:min(760px,100%);max-height:90vh;overflow:auto;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.3)}',
            '.address-validation-dialog h2{margin:0 0 .5rem}.address-validation-dialog h3{margin:.25rem 0 .75rem;font-size:1rem}',
            '.address-validation-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1.5rem 0}',
            '.address-validation-comparison section{padding:1rem;border:1px solid #d8d8d8;border-radius:6px}',
            '.address-validation-comparison section:last-child{border-color:#3973c6;background:#f4f8ff}',
            '.address-validation-comparison pre{margin:0;white-space:pre-wrap;font:inherit;line-height:1.5}',
            '.address-validation-actions{display:flex;justify-content:flex-end;gap:.75rem;flex-wrap:wrap}',
            '.address-validation-actions button{padding:.65rem 1rem;border:1px solid #777;border-radius:4px;background:#fff;cursor:pointer}',
            '.address-validation-actions button.primary{border-color:#1558a6;background:#1558a6;color:#fff}',
            '@media(max-width:600px){.address-validation-comparison{grid-template-columns:1fr}.address-validation-dialog{padding:1.25rem}}'
        ].join('');
        document.head.appendChild(style);
    }

    async function validateAndContinue() {
        var original = readAddress();
        if (!original.regionCode) {
            showError('Select a country before continuing.');
            return;
        }
        if (!original.addressLines.length && !original.postalCode) {
            showError('Enter an address or postal code before continuing.');
            return;
        }

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.value = 'Validating address...';
        }

        try {
            var response = await fetch(apiUrl + '/api/validate-address', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(original)
            });
            var result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Address validation failed.');
            }

            var suggested = result.suggestedAddress || original;
            if (result.status === 'corrected' && !addressesMatch(original, suggested)) {
                addModalStyles();
                createModal(original, suggested);
            } else {
                continueWith(original);
            }
        } catch (error) {
            showError(error.message || 'Address validation is unavailable. Try again.');
        } finally {
            if (!nativeSubmit && submitButton) {
                submitButton.disabled = false;
                submitButton.value = 'Continue';
            }
        }
    }

    form.addEventListener('submit', function (event) {
        if (nativeSubmit) {
            return;
        }
        event.preventDefault();
        validateAndContinue();
    });
})();
