import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ToolbarDropdown = ({ value, options, onChange, ariaLabel, className = '', menuClassName = '', compact = false, portalMenu = false, fitSelectedValue = false, softForeground = false, focusVisibleRing = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const focusOptionWhenOpenedRef = useRef(false);
  const menuId = useId();
  const selectedOption = options.find((option) => option.value === value) || options[0];
  const triggerWidthClass = !compact
    ? 'w-full'
    : fitSelectedValue
      ? 'w-fit max-w-full'
      : 'w-fit max-w-full md:w-full';
  const selectedLabelClass = !compact
    ? 'whitespace-nowrap'
    : fitSelectedValue
      ? 'min-w-0 max-w-[calc(100vw-4rem)] truncate md:max-w-none md:whitespace-nowrap'
      : 'min-w-0 max-w-[calc(100vw-4rem)] truncate md:max-w-[5rem]';
  const foregroundClass = softForeground ? 'text-slate-100' : 'text-white';
  const optionFocusClass = focusVisibleRing
    ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300'
    : '';
  const triggerFocusClass = focusVisibleRing
    ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2'
    : 'focus:border-gray-600 focus:outline-none focus:ring-0';

  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      if (!containerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setIsOpen(false);
        setMenuPosition(null);
      }
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !portalMenu) return undefined;

    const updateMenuPosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (!triggerRect || !menuRect) return;

      const viewportMargin = 8;
      const triggerGap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const preferredMaxHeight = Math.min(320, viewportHeight * 0.5);
      const belowSpace = Math.max(0, viewportHeight - triggerRect.bottom - triggerGap - viewportMargin);
      const aboveSpace = Math.max(0, triggerRect.top - triggerGap - viewportMargin);
      const measuredHeight = Math.min(menuRect.height, preferredMaxHeight);
      const opensAbove = belowSpace < measuredHeight && aboveSpace > belowSpace;
      const availableHeight = opensAbove ? aboveSpace : belowSpace;
      const maxHeight = Math.max(0, Math.min(preferredMaxHeight, availableHeight));
      const renderedHeight = Math.min(measuredHeight, maxHeight);
      const preferredLeft = triggerRect.left;
      const left = Math.min(
        Math.max(preferredLeft, viewportMargin),
        Math.max(viewportMargin, viewportWidth - menuRect.width - viewportMargin)
      );
      const top = opensAbove
        ? Math.max(viewportMargin, triggerRect.top - triggerGap - renderedHeight)
        : Math.min(triggerRect.bottom + triggerGap, viewportHeight - viewportMargin - renderedHeight);

      setMenuPosition((previous) => {
        if (previous?.left === left && previous?.top === top && previous?.maxHeight === maxHeight) return previous;
        return { left, top, maxHeight };
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, portalMenu]);

  useLayoutEffect(() => {
    if (!isOpen || !portalMenu || !menuPosition || !focusOptionWhenOpenedRef.current) return;
    const optionsInMenu = [...(menuRef.current?.querySelectorAll('[role="option"]') || [])];
    (optionsInMenu.find((option) => option.getAttribute('aria-selected') === 'true') || optionsInMenu[0])?.focus();
    focusOptionWhenOpenedRef.current = false;
  }, [isOpen, menuPosition, portalMenu, value]);

  const handleTriggerClick = () => {
    if (isOpen) {
      setIsOpen(false);
      setMenuPosition(null);
      if (portalMenu) triggerRef.current?.focus();
      return;
    }
    focusOptionWhenOpenedRef.current = portalMenu;
    setMenuPosition(null);
    setIsOpen(true);
  };

  const handleTriggerKeyDown = (event) => {
    if (portalMenu && !isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      focusOptionWhenOpenedRef.current = true;
      setMenuPosition(null);
      setIsOpen(true);
    }
  };

  const handleMenuKeyDown = (event) => {
    if (!portalMenu) return;
    const optionsInMenu = [...(menuRef.current?.querySelectorAll('[role="option"]') || [])];
    const currentIndex = optionsInMenu.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      setMenuPosition(null);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? optionsInMenu.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + optionsInMenu.length) % optionsInMenu.length;
      optionsInMenu[nextIndex]?.focus();
      return;
    }
    if (event.key === 'Tab' && event.shiftKey && currentIndex === 0) {
      event.preventDefault();
      setIsOpen(false);
      setMenuPosition(null);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && currentIndex === optionsInMenu.length - 1) {
      event.preventDefault();
      const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
      const pageControls = [...document.querySelectorAll(focusableSelector)]
        .filter((element) => !menuRef.current?.contains(element) && element.getClientRects().length > 0);
      const triggerIndex = pageControls.indexOf(triggerRef.current);
      setIsOpen(false);
      setMenuPosition(null);
      pageControls[triggerIndex + 1]?.focus();
    }
  };

  const menu = isOpen && (
    <div
      ref={menuRef}
      className={`${portalMenu ? 'fixed left-0 top-0 z-40' : `absolute right-0 z-50 ${compact ? 'mt-0 md:mt-2' : 'mt-2'} min-w-full`} overflow-x-hidden overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-1 shadow-xl ${menuClassName}`.trim()}
      style={portalMenu ? {
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        maxHeight: menuPosition?.maxHeight,
        visibility: menuPosition ? 'visible' : 'hidden',
      } : undefined}
      role="listbox"
      aria-label={ariaLabel}
      id={portalMenu ? menuId : undefined}
      onKeyDown={handleMenuKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          onClick={() => {
            onChange(option.value);
            setIsOpen(false);
            setMenuPosition(null);
            if (portalMenu) triggerRef.current?.focus();
          }}
          className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium ${foregroundClass} transition-colors [overflow-wrap:anywhere] ${option.value === value ? 'bg-white/15' : 'hover:bg-white/10'} ${optionFocusClass}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={`${compact ? 'inline-flex justify-start md:flex md:justify-between' : 'flex justify-between'} h-[37px] ${triggerWidthClass} min-w-0 items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-2 py-1.5 text-left text-xs font-medium ${foregroundClass} shadow-sm transition-all hover:bg-gray-800 ${triggerFocusClass}`}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={portalMenu && isOpen ? menuId : undefined}
      >
        <span className={selectedLabelClass}>{selectedOption?.label}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg>
      </button>

      {portalMenu && menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
};

export default ToolbarDropdown;
