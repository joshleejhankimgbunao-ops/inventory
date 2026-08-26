import React, { useEffect, useRef, useState } from 'react';

const ToolbarDropdown = ({ value, options, onChange, ariaLabel, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex h-[37px] w-full items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-900 px-2 py-1.5 text-left text-xs font-medium text-white shadow-sm transition-all hover:bg-gray-800 focus:border-gray-600 focus:outline-none focus:ring-0"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="whitespace-nowrap">{selectedOption?.label}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 min-w-full overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-1 shadow-xl" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => { onChange(option.value); setIsOpen(false); }}
              className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-white transition-colors ${option.value === value ? 'bg-white/15' : 'hover:bg-white/10'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolbarDropdown;
