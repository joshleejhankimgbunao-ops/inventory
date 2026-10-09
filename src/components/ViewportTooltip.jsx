import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_GAP = 8;
const TRIGGER_GAP = 6;

const ViewportTooltip = ({ content, children, maxWidth = 280 }) => {
    const triggerRef = useRef(null);
    const tooltipRef = useRef(null);
    const tooltipId = useId();
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0, arrowLeft: 16, placement: 'above', ready: false });

    const updatePosition = useCallback(() => {
        const triggerRect = triggerRef.current?.getBoundingClientRect();
        const tooltipRect = tooltipRef.current?.getBoundingClientRect();
        if (!triggerRect || !tooltipRect) return;

        const canFitAbove = triggerRect.top >= tooltipRect.height + TRIGGER_GAP + VIEWPORT_GAP;
        const placement = canFitAbove ? 'above' : 'below';
        const preferredLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
        const left = Math.min(
            Math.max(preferredLeft, VIEWPORT_GAP),
            Math.max(VIEWPORT_GAP, window.innerWidth - tooltipRect.width - VIEWPORT_GAP)
        );
        const preferredTop = placement === 'above'
            ? triggerRect.top - tooltipRect.height - TRIGGER_GAP
            : triggerRect.bottom + TRIGGER_GAP;
        const top = Math.min(
            Math.max(preferredTop, VIEWPORT_GAP),
            Math.max(VIEWPORT_GAP, window.innerHeight - tooltipRect.height - VIEWPORT_GAP)
        );
        const triggerCenter = triggerRect.left + (triggerRect.width / 2);
        const arrowLeft = Math.min(Math.max(triggerCenter - left, 12), tooltipRect.width - 12);

        setPosition({ top, left, arrowLeft, placement, ready: true });
    }, []);

    useEffect(() => {
        if (!isOpen) return undefined;
        const animationFrame = window.requestAnimationFrame(updatePosition);
        return () => window.cancelAnimationFrame(animationFrame);
    }, [isOpen, content, updatePosition]);

    useEffect(() => {
        if (!isOpen) return undefined;
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen, updatePosition]);

    const hasContent = Boolean(content);
    const child = isValidElement(children)
        ? cloneElement(children, {
            'aria-describedby': isOpen && hasContent ? tooltipId : children.props['aria-describedby'],
        })
        : children;

    return (
        <span
            ref={triggerRef}
            className="inline-flex"
            onMouseEnter={() => hasContent && setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
            onFocusCapture={() => hasContent && setIsOpen(true)}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
            }}
        >
            {child}
            {isOpen && hasContent && typeof document !== 'undefined' && createPortal(
                <span
                    ref={tooltipRef}
                    id={tooltipId}
                    role="tooltip"
                    className="pointer-events-none fixed z-[100] rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-semibold leading-snug text-white shadow-lg ring-1 ring-black/10"
                    style={{
                        top: position.top,
                        left: position.left,
                        maxWidth: `min(${maxWidth}px, calc(100vw - ${VIEWPORT_GAP * 2}px))`,
                        visibility: position.ready ? 'visible' : 'hidden',
                    }}
                >
                    {content}
                    <span
                        aria-hidden="true"
                        className={`absolute h-2 w-2 rotate-45 bg-slate-900 ${position.placement === 'above' ? '-bottom-1' : '-top-1'}`}
                        style={{ left: position.arrowLeft - 4 }}
                    />
                </span>,
                document.body
            )}
        </span>
    );
};

export default ViewportTooltip;
