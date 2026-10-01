# Application review — October 1, 2026

Scope: local frontend checkout script, Express API, configuration, Google and Smarty adapters, and regression tests. No production deployment or live provider calls were performed.

## Fixes implemented

- Prevent concurrent validation requests and repeat requests while an address review dialog is open.
- Reject stale validation results when the shopper changes address fields during the request, preserving their new input.
- Re-enable the submit button before native submission; reset the bypass flag after synchronous native submission so a blocked checkout can be validated again. Omit the requestSubmit argument when there is no submit button.
- Preserve provider suggestion lines beyond the second by joining them into the checkout's second address field.
- Preserve the company in suggested-address comparisons when providers omit organization.
- Reject unknown frontend result statuses instead of silently submitting.
- Remove console logging of the customer's address.
- Protect PO boxes from the company relocation heuristic.
- Keep Google's abort deadline active through response-body parsing and return controlled 502 errors for malformed success responses.
- Require complete positive safe integers in numeric configuration.
- Treat Smarty international Partial results as unconfirmed rather than invalid.

- Generate server request IDs, return X-Request-ID, and log bounded error categories without raw error objects, addresses, credentials, or stacks. Provider error logs include the request ID.
- Expose all returned Smarty candidates and allow selection in the review dialog.
- Trap Tab/Shift+Tab within the dialog; close on Escape and restore prior focus on close.
- Update and restore visible button labels during validation.
- Abort browser validation after 15 seconds (including response parsing), restore checkout controls, preserve the address, and permit retry. Override with data-validation-timeout-ms on the checkout form.

- Detect Smarty corrections by comparing input street/unit, city, region, and postal fields with output, including nested international component-change metadata. Formatting normalization covers case, whitespace, common US street/unit abbreviations, US state names/codes, and US ZIP+4 enrichment. International mailing-only locality/region/postal/company lines are excluded from street comparison. Unknown differences remain conservative and request review. Partial/ambiguous/invalid results retain their existing review status.
- Treat Google component-level spelling/replacement flags as corrections even when aggregate correction flags are missing.

## Remaining findings and enhancements

| Priority | Finding | Recommended work |
| --- | --- | --- |
| High | Smarty international address1–address8 are mailing lines and can contain locality, postal code, or organization. Applying them directly to street fields can duplicate those values in an order. | Build country-aware street-field mapping from components, retaining full mailing lines only for display. Verify against representative countries before rollout. |
| Medium | Company detection uses English suffixes and number-first streets; it cannot reliably identify every international company/street combination. | Add country-specific detection with conservative fallbacks and regression fixtures. |
| Medium | Wildcard origin rules are matched as strings rather than parsed URL hostnames. Origin checks are browser access controls, not authentication for billable API use. | Parse URL origins and add usage monitoring and, if needed, a storefront-issued short-lived token. |

Provider reference: https://www.smarty.com/docs/apis/international-street-api/reference

Validation: full automated suite passed after the fixes, including timeout/retry, candidate selection, keyboard behavior, and redacted logging regression tests. Browser behavior is modeled by the test harness; live storefront integration, keyboard interaction, network failure behavior, and country-specific provider output still require browser/provider verification.
