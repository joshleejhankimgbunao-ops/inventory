import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_GUTTER = 8;
const DROPDOWN_GAP = 4;
const PREFERRED_MAX_HEIGHT = 240;
const MINIMUM_USEFUL_SPACE = 144;

const SupplierSelector = ({
    isOpen,
    onOpenChange,
    options,
    query,
    onQueryChange,
    onSelect,
    selectedValue,
    placeholder,
}) => {
    const anchorRef = useRef(null);
    const dropdownRef = useRef(null);
    const optionRefs = useRef([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [position, setPosition] = useState({
        left: 0,
        top: 0,
        bottom: 'auto',
        width: 0,
        maxHeight: PREFERRED_MAX_HEIGHT,
        placement: 'below',
        ready: false,
    });

    const closeDropdown = useCallback(() => {
        setActiveIndex(-1);
        onOpenChange(false);
    }, [onOpenChange]);

    const updatePosition = useCallback(() => {
        const anchor = anchorRef.current;
        if (!anchor || typeof window === 'undefined') return;

        const rect = anchor.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_GUTTER;
        const spaceAbove = rect.top - DROPDOWN_GAP - VIEWPORT_GUTTER;
        const placement = spaceBelow < MINIMUM_USEFUL_SPACE && spaceAbove > spaceBelow ? 'above' : 'below';
        const availableSpace = placement === 'above' ? spaceAbove : spaceBelow;
        const maxHeight = Math.max(0, Math.min(PREFERRED_MAX_HEIGHT, availableSpace));
        const width = Math.min(rect.width, window.innerWidth - (VIEWPORT_GUTTER * 2));
        const left = Math.min(
            Math.max(VIEWPORT_GUTTER, rect.left),
            window.innerWidth - width - VIEWPORT_GUTTER
        );

        setPosition({
            left,
            top: placement === 'below' ? rect.bottom + DROPDOWN_GAP : 'auto',
            bottom: placement === 'above' ? window.innerHeight - rect.top + DROPDOWN_GAP : 'auto',
            width,
            maxHeight,
            placement,
            ready: true,
        });
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) return undefined;

        updatePosition();
        const frameId = window.requestAnimationFrame(updatePosition);
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updatePosition);
        resizeObserver?.observe(anchorRef.current);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.cancelAnimationFrame(frameId);
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen, options.length, updatePosition]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event) => {
            if (anchorRef.current?.contains(event.target) || dropdownRef.current?.contains(event.target)) return;
            closeDropdown();
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [closeDropdown, isOpen]);

    useEffect(() => {
        if (activeIndex < 0) return;
        optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const selectOption = (option) => {
        onSelect(option);
        closeDropdown();
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            closeDropdown();
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen) onOpenChange(true);
            if (options.length === 0) return;
            setActiveIndex((current) => {
                if (event.key === 'ArrowDown') return current >= options.length - 1 ? 0 : current + 1;
                return current <= 0 ? options.length - 1 : current - 1;
            });
            return;
        }

        if (event.key === 'Enter' && isOpen && activeIndex >= 0 && options[activeIndex]) {
            event.preventDefault();
            selectOption(options[activeIndex]);
        }
    };

    const dropdown = isOpen && typeof document !== 'undefined' ? createPortal(
        <ul
            ref={dropdownRef}
            id="supplier-options"
            role="listbox"
            aria-label="Supplier options"
            className="fixed z-[80] overflow-y-auto overscroll-contain rounded-lg border border-gray-100 bg-white py-1 shadow-xl dark:border-gray-600 dark:bg-gray-700"
            style={{
                left: position.left,
                top: position.top,
                bottom: position.bottom,
                width: position.width,
                maxHeight: position.maxHeight,
                visibility: position.ready ? 'visible' : 'hidden',
            }}
            data-placement={position.placement}
        >
            {options.length === 0 && (
                <li className="p-3 text-center text-xs italic text-gray-400">No matching supplier partners.</li>
            )}
            {options.map((option, index) => (
                <li
                    key={option}
                    id={`supplier-option-${index}`}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    role="option"
                    aria-selected={selectedValue === option}
                    className={`flex cursor-pointer items-center justify-between border-b border-gray-50 px-3 py-2 text-xs transition-colors last:border-0 dark:border-gray-600/50 ${
                        activeIndex === index ? 'bg-gray-100 dark:bg-gray-600' : 'hover:bg-gray-50 dark:hover:bg-gray-600'
                    } ${selectedValue === option ? 'bg-blue-50 font-semibold text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                >
                    <span>{option}</span>
                    {selectedValue === option && (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </li>
            ))}
        </ul>,
        document.body
    ) : null;

    return (
        <div ref={anchorRef} className="relative w-full">
            <input
                type="text"
                value={query}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="supplier-options"
                aria-expanded={isOpen}
                aria-activedescendant={activeIndex >= 0 ? `supplier-option-${activeIndex}` : undefined}
                onChange={(event) => {
                    onQueryChange(event.target.value);
                    setActiveIndex(-1);
                    if (!isOpen) onOpenChange(true);
                }}
                onFocus={() => onOpenChange(true)}
                onKeyDown={handleKeyDown}
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-10 text-xs font-medium text-gray-900 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-gray-500"
                placeholder={placeholder}
            />
            <button
                type="button"
                aria-label={isOpen ? 'Close supplier options' : 'Open supplier options'}
                onClick={() => isOpen ? closeDropdown() : onOpenChange(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
            >
                <svg className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {dropdown}
        </div>
    );
};

export default SupplierSelector;
