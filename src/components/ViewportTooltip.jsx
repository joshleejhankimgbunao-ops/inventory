import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_GAP = 8;
const TRIGGER_GAP = 6;

const ViewportTooltip = ({
    content,
    children,
    maxWidth = 280,
    tooltipClassName = '',
    triggerClassName = '',
    placementPreference = 'above',
    align = 'center',
    positionAnchorId = null,
    pointerAnchorSelector = null,
    triggerGap = TRIGGER_GAP,
    openDelay = 0,
    closeDelay = 0,
    animateAppearance = false,
}) => {
    const triggerRef = useRef(null);
    const tooltipRef = useRef(null);
    const pointerAnchorRef = useRef(null);
    const pointerCoordinatesRef = useRef(null);
    const openTimerRef = useRef(null);
    const closeTimerRef = useRef(null);
    const tooltipId = useId();
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0, arrowLeft: 16, arrowTop: 12, placement: 'above', ready: false });
    const hasContent = Boolean(content);

    const clearOpenTimer = useCallback(() => {
        if (openTimerRef.current !== null) {
            window.clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
    }, []);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current !== null) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    const openTooltip = useCallback((delay = openDelay) => {
        if (!hasContent) return;
        clearOpenTimer();
        clearCloseTimer();
        if (!isOpen) setPosition((currentPosition) => ({ ...currentPosition, ready: false }));
        if (delay <= 0) {
            setIsOpen(true);
            return;
        }
        openTimerRef.current = window.setTimeout(() => {
            openTimerRef.current = null;
            setIsOpen(true);
        }, delay);
    }, [clearCloseTimer, clearOpenTimer, hasContent, isOpen, openDelay]);

    const closeTooltip = useCallback((delay = closeDelay) => {
        clearOpenTimer();
        clearCloseTimer();
        if (delay <= 0) {
            setIsOpen(false);
            return;
        }
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            setIsOpen(false);
        }, delay);
    }, [clearCloseTimer, clearOpenTimer, closeDelay]);

    const updatePosition = useCallback(() => {
        let positionAnchor = positionAnchorId ? document.getElementById(positionAnchorId) : null;
        if (pointerAnchorSelector) {
            const pointerCoordinates = pointerCoordinatesRef.current;
            const elementUnderPointer = pointerCoordinates
                ? document.elementFromPoint(pointerCoordinates.x, pointerCoordinates.y)
                : null;
            const matchingPointerAnchor = elementUnderPointer?.closest?.(pointerAnchorSelector);
            if (matchingPointerAnchor && triggerRef.current?.contains(matchingPointerAnchor)) {
                pointerAnchorRef.current = matchingPointerAnchor;
            } else if (elementUnderPointer && triggerRef.current?.contains(elementUnderPointer)) {
                pointerAnchorRef.current = triggerRef.current;
            }

            const rememberedPointerAnchor = pointerAnchorRef.current;
            positionAnchor = rememberedPointerAnchor?.isConnected && triggerRef.current?.contains(rememberedPointerAnchor)
                ? rememberedPointerAnchor
                : pointerCoordinates
                    ? triggerRef.current
                    : positionAnchor;
        }
        const triggerRect = (positionAnchor || triggerRef.current)?.getBoundingClientRect();
        const tooltipElement = tooltipRef.current;
        const tooltipWidth = tooltipElement?.offsetWidth;
        const tooltipHeight = tooltipElement?.offsetHeight;
        if (!triggerRect || !tooltipElement || !tooltipWidth || !tooltipHeight) return;

        const canFitAbove = triggerRect.top >= tooltipHeight + triggerGap + VIEWPORT_GAP;
        const canFitLeft = triggerRect.left >= tooltipWidth + triggerGap + VIEWPORT_GAP;
        const canFitRight = window.innerWidth - triggerRect.right >= tooltipWidth + triggerGap + VIEWPORT_GAP;
        let placement = placementPreference;
        if (placement === 'left' && !canFitLeft) placement = canFitRight ? 'right' : canFitAbove ? 'above' : 'below';
        else if (placement === 'right' && !canFitRight) placement = canFitLeft ? 'left' : canFitAbove ? 'above' : 'below';
        else if (placement !== 'left' && placement !== 'right') placement = canFitAbove ? 'above' : 'below';

        const preferredLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipWidth / 2);
        const preferredTop = placement === 'above'
            ? triggerRect.top - tooltipHeight - triggerGap
            : placement === 'below'
                ? triggerRect.bottom + triggerGap
                : align === 'start'
                    ? triggerRect.top
                    : triggerRect.top + (triggerRect.height / 2) - (tooltipHeight / 2);
        const preferredSideLeft = placement === 'left'
            ? triggerRect.left - tooltipWidth - triggerGap
            : placement === 'right'
                ? triggerRect.right + triggerGap
                : preferredLeft;
        const left = Math.min(
            Math.max(preferredSideLeft, VIEWPORT_GAP),
            Math.max(VIEWPORT_GAP, window.innerWidth - tooltipWidth - VIEWPORT_GAP)
        );
        const top = Math.min(
            Math.max(preferredTop, VIEWPORT_GAP),
            Math.max(VIEWPORT_GAP, window.innerHeight - tooltipHeight - VIEWPORT_GAP)
        );
        const triggerCenter = triggerRect.left + (triggerRect.width / 2);
        const arrowLeft = Math.min(Math.max(triggerCenter - left, 12), tooltipWidth - 12);
        const triggerMiddle = triggerRect.top + (triggerRect.height / 2);
        const arrowTop = Math.min(Math.max(triggerMiddle - top, 8), tooltipHeight - 8);

        setPosition({ top, left, arrowLeft, arrowTop, placement, ready: true });
    }, [align, placementPreference, pointerAnchorSelector, positionAnchorId, triggerGap]);

    const rememberPointerAnchor = useCallback((event) => {
        if (!pointerAnchorSelector) return;
        pointerCoordinatesRef.current = { x: event.clientX, y: event.clientY };
        const matchingPointerAnchor = event.target?.closest?.(pointerAnchorSelector);
        const nextPointerAnchor = matchingPointerAnchor && triggerRef.current?.contains(matchingPointerAnchor)
            ? matchingPointerAnchor
            : triggerRef.current;
        if (pointerAnchorRef.current !== nextPointerAnchor) {
            pointerAnchorRef.current = nextPointerAnchor;
            if (isOpen) updatePosition();
        }
    }, [isOpen, pointerAnchorSelector, updatePosition]);

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

    useEffect(() => {
        if (!isOpen || !positionAnchorId) return undefined;

        const trigger = triggerRef.current;
        const transitionContainer = trigger?.parentElement;
        const positionAnchor = document.getElementById(positionAnchorId);
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updatePosition);
        [trigger, positionAnchor, tooltipRef.current, transitionContainer].forEach((element) => {
            if (element) resizeObserver?.observe(element);
        });
        transitionContainer?.addEventListener('transitionend', updatePosition);

        return () => {
            resizeObserver?.disconnect();
            transitionContainer?.removeEventListener('transitionend', updatePosition);
        };
    }, [isOpen, positionAnchorId, updatePosition]);

    useEffect(() => () => {
        clearOpenTimer();
        clearCloseTimer();
    }, [clearCloseTimer, clearOpenTimer]);

    const child = isValidElement(children)
        ? cloneElement(children, {
            'aria-describedby': isOpen && hasContent ? tooltipId : children.props['aria-describedby'],
        })
        : children;

    return (
        <span
            ref={triggerRef}
            className={`inline-flex ${triggerClassName}`.trim()}
            onMouseEnter={(event) => {
                rememberPointerAnchor(event);
                openTooltip();
            }}
            onMouseMove={rememberPointerAnchor}
            onMouseLeave={() => {
                pointerAnchorRef.current = null;
                pointerCoordinatesRef.current = null;
                const activeElement = document.activeElement;
                const hasKeyboardFocus = triggerRef.current?.contains(activeElement)
                    && activeElement?.matches?.(':focus-visible');
                if (!hasKeyboardFocus) closeTooltip();
                else if (pointerAnchorSelector) updatePosition();
            }}
            onFocusCapture={(event) => {
                if (event.target.matches?.(':focus-visible')) openTooltip(0);
            }}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) closeTooltip(0);
            }}
        >
            {child}
            {isOpen && hasContent && typeof document !== 'undefined' && createPortal(
                <span
                    ref={tooltipRef}
                    id={tooltipId}
                    role="tooltip"
                    className={`fixed pointer-events-none z-[100] rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-semibold leading-snug text-white shadow-lg ring-1 ring-black/10 ${animateAppearance ? 'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none' : ''} ${tooltipClassName}`.trim()}
                    style={{
                        top: position.top,
                        left: position.left,
                        maxWidth: `min(${maxWidth}px, calc(100vw - ${VIEWPORT_GAP * 2}px))`,
                        visibility: position.ready ? 'visible' : 'hidden',
                        opacity: !animateAppearance || position.ready ? 1 : 0,
                        transform: !animateAppearance || position.ready ? 'translateX(0) scale(1)' : 'translateX(2px) scale(0.98)',
                    }}
                >
                    {content}
                    <span
                        aria-hidden="true"
                        className={`absolute h-2 w-2 rotate-45 bg-slate-900 ${position.placement === 'above' ? '-bottom-1' : position.placement === 'below' ? '-top-1' : position.placement === 'left' ? '-right-1' : '-left-1'}`}
                        style={position.placement === 'left' || position.placement === 'right'
                            ? { top: position.arrowTop - 4 }
                            : { left: position.arrowLeft - 4 }}
                    />
                </span>,
                document.body
            )}
        </span>
    );
};

export default ViewportTooltip;
