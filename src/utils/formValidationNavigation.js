const INVALID_CONTROL_SELECTOR = [
  'input:invalid',
  'select:invalid',
  'textarea:invalid',
  '[aria-invalid="true"]',
  '[data-invalid="true"]',
  '[data-validation-error="true"]',
].join(',');

const FOCUSABLE_SELECTOR = 'input, select, textarea, button, [tabindex], [contenteditable="true"], [role="combobox"]';
let generatedMessageSequence = 0;
let pendingValidationSubmissionScope = null;

const isElement = (value) => value && value.nodeType === 1;

const isDisabledOrReadOnly = (element) => Boolean(
  element.disabled
  || element.readOnly
  || element.getAttribute('aria-disabled') === 'true'
  || element.closest('[inert]')
);

const hasVisibleBox = (element) => {
  if (!isElement(element) || element.hidden || element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
};

const getVisiblePresentationTarget = (element) => {
  if (hasVisibleBox(element)) return element;
  if (element?.matches?.('input[type="file"]')) {
    return Array.from(element.labels || []).find((label) => hasVisibleBox(label)) || null;
  }
  return null;
};

const getFocusableValidationTarget = (candidate, scope) => {
  if (candidate.matches(FOCUSABLE_SELECTOR) && hasVisibleBox(candidate)) return candidate;
  const validationKey = candidate.dataset?.validationKey;
  if (validationKey) {
    const visibleEquivalent = Array.from(scope.querySelectorAll(FOCUSABLE_SELECTOR)).find((control) => (
      control !== candidate
      && control.dataset?.validationKey === validationKey
      && hasVisibleBox(control)
      && !isDisabledOrReadOnly(control)
    ));
    if (visibleEquivalent) return visibleEquivalent;
  }
  if (candidate.matches(FOCUSABLE_SELECTOR)) return candidate;
  const descendant = candidate.querySelector(FOCUSABLE_SELECTOR);
  return descendant ? getFocusableValidationTarget(descendant, scope) : candidate;
};

const getInvalidFields = (scope) => {
  if (!isElement(scope)) return [];
  const candidates = Array.from(scope.querySelectorAll(INVALID_CONTROL_SELECTOR));
  return candidates
    .map((candidate) => getFocusableValidationTarget(candidate, scope))
    .filter((field, index, fields) => fields.indexOf(field) === index && !isDisabledOrReadOnly(field));
};

const getControlledDisclosure = (hiddenElement) => {
  const panelId = hiddenElement?.id;
  if (!panelId || !hiddenElement.ownerDocument) return null;
  const controls = Array.from(hiddenElement.ownerDocument.querySelectorAll('[aria-controls]'));
  return controls.find((control) => (
    control.getAttribute('aria-controls')?.split(/\s+/).includes(panelId)
    && (
      control.getAttribute('aria-expanded') === 'false'
      || (control.getAttribute('role') === 'tab' && control.getAttribute('aria-selected') === 'false')
    )
    && !control.disabled
  )) || null;
};

const revealField = (field, scope, attemptedTriggers) => {
  let changed = false;
  const details = field.closest('details:not([open])');
  if (details) {
    details.open = true;
    changed = true;
  }

  let ancestor = field.parentElement;
  while (ancestor && ancestor !== scope.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const hidden = ancestor.hidden
      || ancestor.getAttribute('aria-hidden') === 'true'
      || style.display === 'none'
      || style.visibility === 'hidden';
    if (hidden) {
      const trigger = getControlledDisclosure(ancestor);
      if (trigger && !attemptedTriggers.has(trigger)) {
        attemptedTriggers.add(trigger);
        trigger.click();
        changed = true;
      }
    }
    if (ancestor === scope) break;
    ancestor = ancestor.parentElement;
  }

  return changed;
};

const isVerticallyScrollable = (element) => {
  const style = window.getComputedStyle(element);
  return /(auto|scroll|overlay)/.test(style.overflowY)
    && element.scrollHeight > element.clientHeight + 1;
};

const getVisibleScrollBounds = (container, top, bottom) => {
  let visibleTop = top + Number(container.dataset.validationOffsetTop || 0);
  let visibleBottom = bottom - Number(container.dataset.validationOffsetBottom || 0);
  const candidates = Array.from(document.querySelectorAll('[data-validation-sticky], header, footer, [role="banner"], [role="contentinfo"], [class*="sticky"]'));
  const containerRect = container === document.documentElement
    ? { left: 0, right: window.innerWidth }
    : container.getBoundingClientRect();

  candidates.forEach((candidate) => {
    if (candidate === container) return;
    const style = window.getComputedStyle(candidate);
    if (style.position !== 'sticky' && style.position !== 'fixed') return;
    if (style.position === 'sticky' && !container.contains(candidate)) return;
    const rect = candidate.getBoundingClientRect();
    if (rect.right <= containerRect.left || rect.left >= containerRect.right) return;
    if (rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8) return;

    if (rect.top <= visibleTop + 2 && rect.bottom > visibleTop) {
      visibleTop = Math.max(visibleTop, rect.bottom + 8);
    }
    if (rect.bottom >= visibleBottom - 2 && rect.top < visibleBottom) {
      visibleBottom = Math.min(visibleBottom, rect.top - 8);
    }
  });

  return { visibleTop, visibleBottom };
};

const scrollElementIntoPosition = (element, behavior) => {
  const ancestors = [];
  let parent = element.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    if (isVerticallyScrollable(parent)) ancestors.push(parent);
    parent = parent.parentElement;
  }

  const centerInContainer = (container) => {
    const targetRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const top = containerRect.top + container.clientTop;
    const bottom = top + container.clientHeight;
    const { visibleTop, visibleBottom } = getVisibleScrollBounds(container, top, bottom);
    const outsideVisibleArea = targetRect.top < visibleTop || targetRect.bottom > visibleBottom;
    const targetCenter = targetRect.top + targetRect.height / 2;
    const visibleCenter = visibleTop + (visibleBottom - visibleTop) / 2;
    const delta = outsideVisibleArea ? targetCenter - visibleCenter : 0;
    if (Math.abs(delta) > 2) {
      const nextTop = container.scrollTop + delta;
      if (behavior === 'smooth') container.scrollTo({ top: nextTop, behavior });
      else container.scrollTop = nextTop;
    }
  };

  ancestors.forEach(centerInContainer);

  const rect = element.getBoundingClientRect();
  const { visibleTop: viewportTop, visibleBottom: viewportBottom } = getVisibleScrollBounds(document.documentElement, 8, window.innerHeight - 8);
  const outsideViewport = rect.top < viewportTop || rect.bottom > viewportBottom;
  const viewportCenter = viewportTop + (viewportBottom - viewportTop) / 2;
  const delta = outsideViewport ? rect.top + rect.height / 2 - viewportCenter : 0;
  if (Math.abs(delta) > 2) {
    const nextTop = window.scrollY + delta;
    if (behavior === 'smooth') window.scrollTo({ top: nextTop, behavior });
    else window.scrollTo(0, nextTop);
  }
};

const focusField = (field) => {
  if (!isElement(field) || isDisabledOrReadOnly(field)) return false;
  const presentationTarget = getVisiblePresentationTarget(field);
  if (!presentationTarget) return false;

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  scrollElementIntoPosition(presentationTarget, reduceMotion ? 'auto' : 'smooth');
  if (document.activeElement !== field && typeof field.focus === 'function') {
    field.focus({ preventScroll: true });
  }
  return true;
};

const addDescribedBy = (element, id) => {
  const ids = new Set((element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  ids.add(id);
  element.setAttribute('aria-describedby', Array.from(ids).join(' '));
};

const appendInlineMessage = (field, message) => {
  const existingId = (field.getAttribute('aria-describedby') || '').split(/\s+/)
    .find((id) => field.ownerDocument.getElementById(id)?.matches('[role="alert"], [data-field-error]'));
  const existing = existingId ? field.ownerDocument.getElementById(existingId) : null;
  if (existing) {
    if (existing.dataset.validationGeneratedMessage === 'true') existing.textContent = message;
    return existing;
  }

  const messageElement = field.ownerDocument.createElement('span');
  messageElement.id = `form-validation-error-${++generatedMessageSequence}`;
  messageElement.className = 'form-validation-error-message';
  messageElement.setAttribute('role', 'alert');
  messageElement.dataset.validationGeneratedMessage = 'true';
  messageElement.textContent = message;
  const label = field.closest('label');
  let insertionPoint = label || field.parentElement;
  while (insertionPoint && insertionPoint !== label) {
    const display = window.getComputedStyle(insertionPoint).display;
    if (display !== 'flex' && display !== 'inline-flex' && display !== 'grid' && display !== 'inline-grid') break;
    insertionPoint = insertionPoint.parentElement;
  }
  if (!insertionPoint) insertionPoint = field.parentElement;
  insertionPoint?.insertAdjacentElement('afterend', messageElement);
  addDescribedBy(field, messageElement.id);
  return messageElement;
};

const markFieldInvalid = (field, message) => {
  if (!isElement(field)) return;
  if (!field.hasAttribute('data-validation-previous-aria-invalid')) {
    field.dataset.validationPreviousAriaInvalid = field.getAttribute('aria-invalid') ?? '';
  }
  field.setAttribute('aria-invalid', 'true');
  field.dataset.validationGeneratedInvalid = 'true';
  const presentationTarget = getVisiblePresentationTarget(field);
  if (presentationTarget && presentationTarget !== field) {
    presentationTarget.dataset.validationGeneratedInvalidLabel = 'true';
  }
  if (message) appendInlineMessage(field, message);
  const form = field.closest('form, [data-validation-scope]');
  form?.setAttribute('data-validation-submitted', 'true');
};

const restoreFieldState = (field) => {
  if (!isElement(field) || field.dataset.validationGeneratedInvalid !== 'true') return;
  const previousAriaInvalid = field.dataset.validationPreviousAriaInvalid;
  if (previousAriaInvalid) field.setAttribute('aria-invalid', previousAriaInvalid);
  else field.removeAttribute('aria-invalid');
  delete field.dataset.validationGeneratedInvalid;
  delete field.dataset.validationPreviousAriaInvalid;
  const presentationTarget = getVisiblePresentationTarget(field);
  if (presentationTarget && presentationTarget.dataset.validationGeneratedInvalidLabel === 'true') {
    delete presentationTarget.dataset.validationGeneratedInvalidLabel;
  }

  const describedBy = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  describedBy.forEach((id) => {
    const message = field.ownerDocument.getElementById(id);
    if (message?.dataset.validationGeneratedMessage === 'true') message.remove();
  });
  const remainingIds = describedBy.filter((id) => field.ownerDocument.getElementById(id));
  if (remainingIds.length) field.setAttribute('aria-describedby', remainingIds.join(' '));
  else field.removeAttribute('aria-describedby');
  if (typeof field.setCustomValidity === 'function') field.setCustomValidity('');
};

export const normalizeFieldKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\[(\d+)\]/g, '.$1')
  .replace(/[^a-z0-9.]/g, '');

export const getFieldErrorEntries = (source) => {
  const value = source?.fieldErrors
    || source?.validationErrors
    || source?.errors
    || source?.details?.fieldErrors
    || source?.details?.errors
    || source?.data?.fieldErrors
    || source?.data?.errors
    || source;

  const entries = [];
  const visit = (entry, prefix = '') => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        const field = item?.field || item?.path || item?.name;
        const message = item?.message || item?.msg;
        if (field && message) entries.push([field, message]);
        else visit(item, prefix ? `${prefix}.${index}` : String(index));
      });
      return;
    }
    if (!entry || typeof entry !== 'object') {
      if (prefix && typeof entry === 'string') entries.push([prefix, entry]);
      return;
    }
    if (prefix && (entry.message || entry.msg)) {
      entries.push([prefix, entry.message || entry.msg]);
      return;
    }
    Object.entries(entry).forEach(([key, child]) => {
      visit(child, prefix ? `${prefix}.${key}` : key);
    });
  };
  visit(value);
  const genericKeys = new Set(['message', 'error', 'status', 'statuscode', 'title', 'code']);
  return entries.filter(([key]) => !genericKeys.has(normalizeFieldKey(key)));
};

const findFieldForError = (scope, errorKey) => {
  const normalizedErrorKey = normalizeFieldKey(errorKey);
  const controls = Array.from(scope.querySelectorAll('input, select, textarea, [role="combobox"], [contenteditable="true"]'));
  const matches = controls.map((control) => {
    const associatedLabels = Array.from(control.labels || []).map((label) => label.textContent);
    let wrapper = control.parentElement;
    let wrapperDepth = 0;
    while (wrapper && wrapper !== scope && wrapperDepth < 3) {
      associatedLabels.push(...Array.from(wrapper.querySelectorAll(':scope > label')).map((label) => label.textContent));
      wrapper = wrapper.parentElement;
      wrapperDepth += 1;
    }
    const identifiers = [
      control.name,
      control.id,
      control.dataset.validationKey,
      control.getAttribute('aria-label'),
      ...String(control.dataset.validationAliases || '').split(/[\s,]+/),
      ...associatedLabels,
    ]
      .filter(Boolean)
      .map(normalizeFieldKey);
    const exactMatch = identifiers.some((identifier) => identifier === normalizedErrorKey);
    const pathSuffixMatch = identifiers.some((identifier) => (
      identifier.length >= 5 && normalizedErrorKey.endsWith(`.${identifier}`)
    ));
    const suffixMatch = identifiers.some((identifier) => (
      identifier.length >= 5 && normalizedErrorKey.endsWith(identifier)
    ));
    const nestedMatch = identifiers.some((identifier) => (
      normalizedErrorKey.length >= 5 && identifier.endsWith(`.${normalizedErrorKey}`)
    ));
    const score = exactMatch ? 0 : pathSuffixMatch ? 1 : suffixMatch ? 2 : nestedMatch ? 3 : Infinity;
    return { control, score, visible: hasVisibleBox(control) };
  }).filter(({ score }) => Number.isFinite(score));
  matches.sort((left, right) => left.score - right.score || Number(right.visible) - Number(left.visible));
  const match = matches[0]?.control;
  if (!match || hasVisibleBox(match)) return match || null;
  return getFocusableValidationTarget(match, scope);
};

export const setFormValidationErrors = (scope, errors) => {
  if (!isElement(scope)) return [];
  const matchedFields = [];
  getFieldErrorEntries(errors).forEach(([key, message]) => {
    const field = findFieldForError(scope, key);
    if (!field || isDisabledOrReadOnly(field)) return;
    if (typeof field.setCustomValidity === 'function') field.setCustomValidity(String(message));
    markFieldInvalid(field, String(message));
    matchedFields.push(field);
  });
  if (matchedFields.length) queueValidationNavigation(scope);
  return matchedFields;
};

const activateFirstInvalidField = (scope, attemptedTriggers = new Set()) => {
  const fields = getInvalidFields(scope);
  const firstField = fields[0];
  if (!firstField) return false;
  if (revealField(firstField, scope, attemptedTriggers)) {
    window.requestAnimationFrame(() => activateFirstInvalidField(scope, attemptedTriggers));
    return true;
  }
  return focusField(firstField);
};

const scheduledFrames = new WeakMap();

export const queueValidationNavigation = (scope) => {
  if (!isElement(scope)) return;
  scope.setAttribute('data-validation-submitted', 'true');
  const previousFrame = scheduledFrames.get(scope);
  if (previousFrame) window.cancelAnimationFrame(previousFrame);
  const frame = window.requestAnimationFrame(() => {
    scheduledFrames.delete(scope);
    activateFirstInvalidField(scope);
  });
  scheduledFrames.set(scope, frame);
};

export const markValidationAttempt = (scope) => queueValidationNavigation(scope);

export const setFirstInvalidFieldError = (scope, message) => {
  if (!isElement(scope)) return [];
  const field = getInvalidFields(scope)[0];
  if (!field) return [];
  markFieldInvalid(field, String(message || field.validationMessage || 'Check this field and try again.'));
  queueValidationNavigation(scope);
  return [field];
};

const getValidationScope = (target) => target?.closest?.('form, [data-validation-scope]') || null;

const rememberValidationSubmission = (scope) => {
  if (!isElement(scope)) return;
  pendingValidationSubmissionScope = scope;
  Promise.resolve().then(() => {
    if (pendingValidationSubmissionScope === scope) pendingValidationSubmissionScope = null;
  });
};

export const consumePendingValidationSubmissionScope = () => {
  const scope = pendingValidationSubmissionScope;
  pendingValidationSubmissionScope = null;
  return scope?.isConnected && hasVisibleBox(scope) ? scope : null;
};

export const installFormValidationNavigation = () => {
  const handleInvalid = (event) => {
    const field = event.target;
    const scope = getValidationScope(field);
    if (!scope) return;
    event.preventDefault();
    markFieldInvalid(field, field.validationMessage || 'Check this field and try again.');
    queueValidationNavigation(scope);
  };

  const handleSubmit = (event) => {
    const scope = getValidationScope(event.target);
    if (!scope) return;
    rememberValidationSubmission(scope);
    queueValidationNavigation(scope);
  };

  const handleValidationButtonClick = (event) => {
    const button = event.target?.closest?.('[data-validation-submit]');
    if (!button || button.disabled) return;
    const scope = getValidationScope(button) || button.closest('[data-validation-form]') || button.parentElement;
    if (!isElement(scope)) return;
    rememberValidationSubmission(scope);
    queueValidationNavigation(scope);
  };

  const handleFieldChange = (event) => {
    const field = event.target;
    if (field?.dataset?.validationGeneratedInvalid === 'true') restoreFieldState(field);
  };

  const handleApiFieldErrors = (event) => {
    const scope = event.detail?.scope;
    if (!scope) return;
    const errors = event.detail?.errors;
    window.requestAnimationFrame(() => {
      if (scope.isConnected && hasVisibleBox(scope)) setFormValidationErrors(scope, errors);
    });
  };

  document.addEventListener('invalid', handleInvalid, true);
  document.addEventListener('submit', handleSubmit, true);
  document.addEventListener('click', handleValidationButtonClick, true);
  document.addEventListener('input', handleFieldChange, true);
  document.addEventListener('change', handleFieldChange, true);
  window.addEventListener('app:field-validation', handleApiFieldErrors);

  return () => {
    document.removeEventListener('invalid', handleInvalid, true);
    document.removeEventListener('submit', handleSubmit, true);
    document.removeEventListener('click', handleValidationButtonClick, true);
    document.removeEventListener('input', handleFieldChange, true);
    document.removeEventListener('change', handleFieldChange, true);
    window.removeEventListener('app:field-validation', handleApiFieldErrors);
  };
};
