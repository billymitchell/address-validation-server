(function () {
  'use strict';

  var form = document.getElementById('checkout-form');
  if (!form) return;

  var apiUrl = (form.dataset.validationApi || 'https://address-validation-centricity-e22fd890f144.herokuapp.com').replace(/\/+$/, '');
  var submitButton = form.querySelector('input[type="submit"], button[type="submit"]');
  var nativeSubmit = false;

  var fields = {
    addressLine1: document.getElementById('website_order_shipping_address_attributes_first_address'),
    addressLine2: document.getElementById('website_order_shipping_address_attributes_second_address'),
    city: document.getElementById('website_order_shipping_address_attributes_city'),
    state: document.getElementById('website_order_shipping_address_attributes_state'),
    postalCode: document.getElementById('website_order_shipping_address_attributes_zip'),
    country: document.getElementById('website_order_shipping_address_attributes_country'),
    company: document.getElementById('website_order_shipping_address_attributes_company')
  };

  var currentAddress = {};

  function valueOf(field) {
    return field ? field.value.trim() : '';
  }

  function getCountryCode() {
    if (!fields.country) return '';
    var selected = fields.country.options[fields.country.selectedIndex];
    return selected && selected.getAttribute('data-region-code')
      || fields.country.value
      || '';
  }

  function readAddress() {
    var address = {
      regionCode: getCountryCode(),
      addressLines: [valueOf(fields.addressLine1), valueOf(fields.addressLine2)].filter(Boolean),
      locality: valueOf(fields.city),
      administrativeArea: valueOf(fields.state),
      postalCode: valueOf(fields.postalCode),
      organization: valueOf(fields.company)
    };

    currentAddress = address;
    console.log('Address state updated:', address);
    return address;
  }

  function showLoader() {
    if (!submitButton) return;
    submitButton.disabled = true;
    submitButton.dataset.originalValue = submitButton.value || 'Continue';
    submitButton.value = 'Verifying address...';
  }

  function hideLoader() {
    if (!submitButton) return;
    submitButton.disabled = false;
    submitButton.value = submitButton.dataset.originalValue || 'Continue';
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

  function normalizeAddress(address) {
    return {
      addressLines: address.addressLines || [],
      locality: address.locality || '',
      administrativeArea: address.administrativeArea || '',
      postalCode: address.postalCode || '',
      regionCode: address.regionCode || '',
      organization: address.organization || ''
    };
  }

  function addressesMatch(a, b) {
    return JSON.stringify(normalizeAddress(a)) === JSON.stringify(normalizeAddress(b));
  }

  function displayAddress(address) {
    var lines = (address.addressLines || []).filter(Boolean);
    if (address.organization) lines.unshift(address.organization);

    if (address.locality || address.administrativeArea || address.postalCode) {
      lines.push([address.locality, address.administrativeArea, address.postalCode].filter(Boolean).join(', '));
    }

    if (address.regionCode) {
      lines.push(address.regionCode);
    }

    return lines.length ? lines.join('\n') : (address.formattedAddress || 'No address provided');
  }

  function applyAddress(address) {
    if (!address) return;

    if (fields.addressLine1) fields.addressLine1.value = (address.addressLines && address.addressLines[0]) || '';
    if (fields.addressLine2) fields.addressLine2.value = (address.addressLines && address.addressLines[1]) || '';
    if (fields.city) fields.city.value = address.locality || '';
    if (fields.postalCode) fields.postalCode.value = address.postalCode || '';
    if (fields.state) fields.state.value = address.administrativeArea || '';
    if (fields.country && address.regionCode) {
      var option = Array.from(fields.country.options).find(function (opt) {
        return (opt.value || '').toLowerCase() === (address.regionCode || '').toLowerCase()
          || opt.getAttribute('data-region-code') === address.regionCode;
      });
      if (option) fields.country.value = option.value;
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

  function createSuggestionModal(original, suggested) {
    var modal = document.createElement('div');
    modal.className = 'address-validation-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'address-validation-title');

    modal.innerHTML = [
      '<div class="address-validation-backdrop"></div>',
      '<div class="address-validation-dialog">',
      '  <h2 id="address-validation-title">Confirm your address</h2>',
      '  <p>We found a possible update. Which address would you like to use?</p>',
      '  <div class="address-validation-comparison">',
      '    <section><h3>Previously entered</h3><pre data-original-address></pre></section>',
      '    <section><h3>Suggested address</h3><pre data-suggested-address></pre></section>',
      '  </div>',
      '  <div class="address-validation-actions">',
      '    <button type="button" data-use-previous>Continue with previous address</button>',
      '    <button type="button" data-use-updated class="primary">Use updated address</button>',
      '  </div>',
      '</div>'
    ].join('');

    modal.querySelector('[data-original-address]').textContent = displayAddress(original);
    modal.querySelector('[data-suggested-address]').textContent = displayAddress(suggested);
    document.body.appendChild(modal);

    var closeAndContinue = function (selectedAddress) {
      modal.remove();
      continueWith(selectedAddress);
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

    var style = document.getElementById('address-validation-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'address-validation-styles';
      style.textContent = [
        '.address-validation-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:1rem}',
        '.address-validation-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}',
        '.address-validation-dialog{position:relative;width:min(760px,100%);background:#fff;padding:2rem;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.25)}',
        '.address-validation-comparison{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.5rem 0}',
        '.address-validation-comparison section{padding:1rem;border:1px solid #d8d8d8;border-radius:6px}',
        '.address-validation-comparison pre{white-space:pre-wrap;font-family:inherit;line-height:1.5;margin:0}',
        '.address-validation-actions{display:flex;justify-content:flex-end;gap:.75rem;flex-wrap:wrap}',
        '.address-validation-actions button{padding:.7rem 1rem;border:1px solid #777;background:#fff;border-radius:4px;cursor:pointer}',
        '.address-validation-actions button.primary{background:#1558a6;color:#fff;border-color:#1558a6}',
        '@media(max-width:600px){.address-validation-comparison{grid-template-columns:1fr}}'
      ].join('');
      document.head.appendChild(style);
    }
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

    showLoader();

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
        createSuggestionModal(original, suggested);
      } else {
        continueWith(original);
      }
    } catch (error) {
      showError(error.message || 'Address validation is unavailable. Try again.');
    } finally {
      if (!nativeSubmit) {
        hideLoader();
      }
    }
  }

  function bindAddressChangeListeners() {
    var inputs = [
      fields.addressLine1,
      fields.addressLine2,
      fields.city,
      fields.state,
      fields.postalCode,
      fields.country,
      fields.company
    ].filter(Boolean);

    inputs.forEach(function (input) {
      input.addEventListener('input', function () {
        readAddress();
      });
      input.addEventListener('change', function () {
        readAddress();
      });
    });
  }

  form.addEventListener('submit', function (event) {
    if (nativeSubmit) return;
    event.preventDefault();
    validateAndContinue();
  });

  bindAddressChangeListeners();
  readAddress();
})();
