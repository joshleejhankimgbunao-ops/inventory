import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VARIANT_CLASS = {
  default: '',
  destructive: 'table-action-button--destructive',
  positive: 'table-action-button--positive',
};

const TableActionButton = ({
  label,
  children,
  variant = 'default',
  className = '',
  type = 'button',
  disabled = false,
  ...props
}) => {
  const buttonRef = useRef(null);
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tooltipWidth = Math.min(Math.max(label.length * 7.2 + 18, 88), 260);
    const above = rect.top >= 42;
    setPosition({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(Math.max(rect.left + (rect.width / 2), (tooltipWidth / 2) + 8), window.innerWidth - (tooltipWidth / 2) - 8),
      transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    });
  }, [label]);

  useEffect(() => {
    if (!isOpen) return undefined;
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const openTooltip = () => {
    updatePosition();
    setIsOpen(true);
  };

  const triggerProps = {
    onMouseEnter: openTooltip,
    onMouseLeave: () => setIsOpen(false),
    onFocus: openTooltip,
    onBlur: () => setIsOpen(false),
  };

  return (
    <span className="inline-flex" {...triggerProps}>
      <button
        {...props}
        ref={buttonRef}
        type={type}
        disabled={disabled}
        aria-label={props['aria-label'] || label}
        aria-describedby={isOpen ? tooltipId : undefined}
        className={`table-action-button ${VARIANT_CLASS[variant] || ''} ${className}`.trim()}
      >
        {children}
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="table-action-tooltip"
          style={{ top: position.top, left: position.left, transform: position.transform }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
};

export default TableActionButton;
